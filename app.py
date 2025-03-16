from quart import Quart, request, jsonify, send_from_directory
from quart_cors import cors
import os
import time
import base64
import uuid
import asyncio
from typing import Dict, Any, List, Tuple
from werkzeug.utils import secure_filename
import google.generativeai as genai
from dotenv import load_dotenv
import fitz  # PyMuPDF
import logging

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('Briefly-pdf')

# Cargar variables de entorno
load_dotenv()

# Configuración inicial de Quart
app = Quart(__name__)
app = cors(app, allow_origin=os.getenv('CORS_ORIGIN', '*'))
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # Aumenta el límite a 50MB

# Inicializar Gemini
API_KEY = os.getenv('GEMINI_API_KEY')
if not API_KEY:
    logger.error("No se encontró la API KEY de Gemini. Verifica tu archivo .env")
    raise ValueError("GEMINI_API_KEY no está configurada en el archivo .env")

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel(model_name="gemini-1.5-flash")  # Usar solo este modelo

# Almacenamiento en memoria para los PDFs procesados
pdf_store = {}
# Almacenamiento para controlar los bloques enviados y sus resúmenes
block_summary_control = {}
# Semáforo para controlar acceso concurrente a recursos compartidos
pdf_semaphore = asyncio.Semaphore(1)

# Función para generar un ID único para cada sesión
def generate_session_id():
    return str(uuid.uuid4())

# Función para convertir imagen a base64
def image_to_base64(image_data):
    return base64.b64encode(image_data).decode('utf-8')

# Función para extraer contenido del PDF (texto e imágenes)
def extract_pdf_contents(buffer):
    try:
        # Cargar el documento PDF con PyMuPDF
        doc = fitz.open(stream=buffer, filetype="pdf")
        total_pages = len(doc)
        pages = []

        logger.info(f"Procesando PDF con {total_pages} páginas")
        
        for i in range(total_pages):
            page = doc[i]
            
            # Extraer texto
            text_items = page.get_text()
            
            # Renderizar página como imagen con resolución optimizada
            pix = page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2))  # Reducida de 1.5 a 1.2 para optimizar
            page_image = pix.tobytes("png")
            page_image_base64 = image_to_base64(page_image)
            
            pages.append({
                'pageNumber': i + 1,
                'text': text_items,
                'fullPageImage': page_image_base64
            })
            logger.info(f"Página {i+1}/{total_pages} procesada")

        return {
            'totalPages': total_pages,
            'pages': pages
        }
    except Exception as error:
        logger.error(f'Error al procesar el PDF: {error}')
        raise Exception(f'No se pudo procesar el archivo PDF: {str(error)}')

# Función para generar un resumen de un solo bloque incluyendo imágenes
async def generate_block_summary(session_id, block_index):
    async with pdf_semaphore:  # Usar semáforo para evitar sobrecarga
        pdf_data = pdf_store.get(session_id)
        if not pdf_data:
            logger.warning(f"No se encontró el PDF para la sesión {session_id}")
            return {'success': False, 'message': 'No se encontró el PDF'}

        total_blocks = (pdf_data['totalPages'] + 2) // 3  # Equivalente a Math.ceil(pdf_data.totalPages / 3)
        
        # Verificar si el bloque solicitado es válido
        if block_index < 0 or block_index >= total_blocks:
            logger.warning(f"Bloque {block_index + 1} fuera de rango para documento con {total_blocks} bloques")
            return {
                'success': False,
                'message': f'El bloque {block_index + 1} no existe. El documento tiene {total_blocks} bloques.'
            }

        # Calcular el rango de páginas para este bloque
        start_page = block_index * 3
        end_page = min(start_page + 3, pdf_data['totalPages'])
        
        logger.info(f"Generando resumen para bloque {block_index+1} (páginas {start_page+1}-{end_page})")
        
        # Obtener el contenido de las páginas en este bloque
        block_pages = []
        block_images = []
        
        for i in range(start_page, end_page):
            block_pages.append({
                'pageNumber': i + 1,
                'content': pdf_data['pages'][i]['text']
            })
            
            # Añadir la imagen de la página completa
            block_images.append({
                'inline_data': {
                    'data': pdf_data['pages'][i]['fullPageImage'],
                    'mime_type': "image/png"
                }
            })
        
        # Construir el prompt para Gemini - optimizado para un solo bloque
        pages_info = "\n".join([
            f"--- PÁGINA {page['pageNumber']} ---\n{page['content']}\n"
            for page in block_pages
        ])
        
        prompt_resumen = f"""
            Eres Briefly, un asistente virtual especializado en resumir documentos.
            
            Genera un resumen conciso y completo del siguiente bloque de páginas (Bloque {block_index + 1}) del documento "{pdf_data['name']}".
            Este resumen debe capturar los puntos clave y la información esencial, incluyendo tanto el texto como el contenido visual de las imágenes que se te proporcionan.
            
            {pages_info}
            
            Formato de respuesta:
            "BLOQUE {block_index + 1} (Páginas {start_page + 1}-{end_page}):\n
            [Resumen que capture los puntos clave de estas páginas en 3-5 oraciones, incluyendo descripción de elementos visuales importantes]"
            
            Mantén el resumen claro y directo, destacando solo la información más relevante. Incluye descripciones de cualquier gráfico, tabla o imagen importante que veas.
        """
        
        try:
            # Crear un array de partes para el modelo de visión
            parts = [
                {"text": prompt_resumen},
                *block_images  # Agregar todas las imágenes del bloque
            ]
            
            # Usar el modelo para procesar imágenes y texto con timeout
            start_time = time.time()
            resultado = await asyncio.wait_for(
                model.generate_content_async(parts),
                timeout=60  # Timeout de 60 segundos
            )
            texto_resumen = resultado.text.strip()
            logger.info(f"Resumen generado en {time.time() - start_time:.2f} segundos")
            
            # Guardar el resumen en el control de bloques
            control = block_summary_control.get(session_id, {
                'lastBlock': block_index,
                'lastSent': time.time(),
                'summaries': {}
            })
            
            control['summaries'][block_index] = texto_resumen
            block_summary_control[session_id] = control
            
            return {
                'success': True,
                'blockIndex': block_index + 1,
                'pageRange': f"{start_page + 1}-{end_page}",
                'summary': texto_resumen,
                'totalBlocks': total_blocks
            }
        except asyncio.TimeoutError:
            logger.error(f"Timeout al generar resumen para el bloque {block_index + 1}")
            return {
                'success': False,
                'message': f"Tiempo de espera agotado al generar el resumen para el Bloque {block_index + 1}. Intenta nuevamente."
            }
        except Exception as error:
            logger.error(f"Error al generar resumen para el bloque {block_index + 1}: {error}")
            return {
                'success': False,
                'message': f"No se pudo generar el resumen para el Bloque {block_index + 1} (Páginas {start_page + 1}-{end_page}): {str(error)}"
            }

# Endpoint de salud
@app.route('/api/health')
async def health_check():
    return jsonify({'status': 'healthy', 'timestamp': time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})

# Endpoint principal para consultas
@app.route('/api/query', methods=['POST'])
async def query():
    try:
        # Extraer datos de la solicitud
        form_data = await request.form
        query = form_data.get('query')
        session_id = form_data.get('sessionId')
        files = await request.files
        
        if not query and not files and not session_id:
            return jsonify({
                'success': False,
                'error': 'Se requiere una consulta, archivos o un ID de sesión'
            }), 400

        # Procesar archivos PDF si se han subido
        if files:
            file = files.getlist('files')[0]  # Tomamos solo el primer archivo
            new_session_id = generate_session_id()
            
            logger.info(f"Procesando archivo: {file.filename}")
            # Verificar que es un PDF
            if not file.filename.lower().endswith('.pdf'):
                return jsonify({
                    'success': False,
                    'error': 'Solo se permiten archivos PDF'
                }), 400
                
            # Leer el archivo PDF (sin await)
            file_buffer = file.read()
            pdf_data = extract_pdf_contents(file_buffer)
            logger.info(f"PDF procesado: {pdf_data['totalPages']} páginas")
            
            # Guardar en el almacenamiento
            pdf_store[new_session_id] = {
                'name': secure_filename(file.filename),
                'totalPages': pdf_data['totalPages'],
                'pages': pdf_data['pages'],
                'timestamp': time.time()
            }
            
            total_blocks = (pdf_data['totalPages'] + 2) // 3
            
            # Mensaje inicial informativo - PRIMER MENSAJE
            message = f"PDF \"{file.filename}\" cargado correctamente. {pdf_data['totalPages']} páginas en {total_blocks} bloques.\n\n"
            message += f"Procesando el Bloque 1 (de {total_blocks})...\n"
            message += "Para ver los siguientes bloques, escribe \"siguiente bloque\" después de recibir cada resumen."
            
            # Iniciar el proceso de generación del primer resumen en segundo plano
            # Esto generará el SEGUNDO MENSAJE (resumen del primer bloque)
            asyncio.create_task(generate_block_summary(new_session_id, 0))
            
            return jsonify({
                'success': True,
                'message': message,
                'sessionId': new_session_id,
                'totalPages': pdf_data['totalPages'],
                'totalBlocks': total_blocks,
                'processingBlock': 1
            })

        # Verificar si es una solicitud para obtener el resumen del bloque actual
        if query and query.lower() == "obtener resumen" and session_id:
            control = block_summary_control.get(session_id)
            if not control:
                return jsonify({
                    'success': False,
                    'message': 'No hay información de bloques para esta sesión. Por favor, sube un PDF primero.'
                })
            
            # Determinar el último bloque procesado
            last_block = control['lastBlock']
            
            # Verificar si tenemos el resumen de este bloque
            if 'summaries' in control and last_block in control['summaries']:
                # Obtener el total de bloques para actualizar la barra de progreso
                pdf_data = pdf_store.get(session_id)
                total_blocks = (pdf_data['totalPages'] + 2) // 3 if pdf_data else 0
                
                return jsonify({
                    'success': True,
                    'message': control['summaries'][last_block],
                    'block': last_block + 1,
                    'totalBlocks': total_blocks,
                    'isBlockSummary': True
                })
            else:
                # Si no tenemos el resumen, intentar generarlo
                summary = await generate_block_summary(session_id, last_block)
                if summary['success']:
                    return jsonify({
                        'success': True,
                        'message': summary['summary'],
                        'block': last_block + 1,
                        'totalBlocks': summary.get('totalBlocks', 0),
                        'isBlockSummary': True
                    })
                else:
                    return jsonify({
                        'success': False,
                        'message': 'No se pudo obtener el resumen del bloque actual: ' + summary['message']
                    })

        # Verificar si es una solicitud para el siguiente bloque
        if query and query.lower() == "siguiente bloque" and session_id:
            control = block_summary_control.get(session_id)
            if not control:
                return jsonify({
                    'success': False,
                    'message': 'No hay información de bloques para esta sesión. Por favor, sube un PDF primero.'
                })
            
            pdf_data = pdf_store.get(session_id)
            if not pdf_data:
                return jsonify({
                    'success': False,
                    'message': 'No se encontró el PDF para esta sesión.'
                })
            
            total_blocks = (pdf_data['totalPages'] + 2) // 3
            next_block = control['lastBlock'] + 1
            
            # Verificar si ya se procesaron todos los bloques
            if next_block >= total_blocks:
                return jsonify({
                    'success': True,
                    'message': 'Has llegado al final del documento. Ya se han procesado todos los bloques disponibles.',
                    'complete': True
                })
            
            # Verificar límite de tiempo (15 segundos entre bloques - reducido de 30)
            now = time.time()
            time_since_last_sent = now - control['lastSent']
            
            if time_since_last_sent < 15:  # 15 segundos entre bloques
                wait_time = int(15 - time_since_last_sent)
                return jsonify({
                    'success': False,
                    'message': f"Por favor espera {wait_time} segundos antes de solicitar el siguiente bloque."
                })
            
            # Actualizar el control para el siguiente bloque
            control['lastBlock'] = next_block
            control['lastSent'] = now
            block_summary_control[session_id] = control
            
            # Mensaje informativo mientras se procesa
            message = f"Procesando el Bloque {next_block + 1} (de {total_blocks})...\n"
            if next_block + 1 < total_blocks:
                message += "Para ver el siguiente bloque después de este, escribe \"siguiente bloque\" nuevamente."
            else:
                message += "Este es el último bloque del documento."
            
            # Iniciar el proceso de generación del resumen en segundo plano
            asyncio.create_task(generate_block_summary(session_id, next_block))
            
            return jsonify({
                'success': True,
                'message': message,
                'processingBlock': next_block + 1,
                'totalBlocks': total_blocks
            })

        # Verificar si es una consulta sobre un bloque específico
        import re
        block_regex = re.compile(r'^bloque\s+(\d+)\s*:\s*(.+)$', re.IGNORECASE)
        block_match = block_regex.match(query) if query else None

        if block_match and session_id:
            block_number = int(block_match.group(1))
            block_query = block_match.group(2).strip()
            
            pdf_data = pdf_store.get(session_id)
            if not pdf_data:
                return jsonify({
                    'success': False,
                    'message': 'No hay ningún PDF cargado para esta sesión. Por favor, sube un PDF primero.'
                })
            
            total_blocks = (pdf_data['totalPages'] + 2) // 3
            
            if block_number < 1 or block_number > total_blocks:
                return jsonify({
                    'success': False,
                    'message': f"El número de bloque debe estar entre 1 y {total_blocks}."
                })
            
            # Obtener las páginas correspondientes al bloque
            start_page = (block_number - 1) * 3
            end_page = min(start_page + 3, pdf_data['totalPages'])
            
            # Obtener el contenido y las imágenes de las páginas en este bloque
            block_pages = []
            block_images = []
            
            for i in range(start_page, end_page):
                block_pages.append({
                    'pageNumber': i + 1,
                    'content': pdf_data['pages'][i]['text']
                })
                
                # Añadir imagen de la página
                block_images.append({
                    'inline_data': {
                        'data': pdf_data['pages'][i]['fullPageImage'],
                        'mime_type': "image/png"
                    }
                })
            
            # Construir el prompt para Gemini
            pages_info = "\n".join([
                f"--- PÁGINA {page['pageNumber']} ---\n{page['content']}\n"
                for page in block_pages
            ])
            
            prompt_consulta = f"""
                Eres Briefly, un asistente virtual amigable y útil.
                La consulta del usuario es: "{block_query}"
                Esta consulta se refiere al Bloque {block_number} (Páginas {start_page + 1}-{end_page}) del documento "{pdf_data['name']}".
                
                Utiliza la siguiente información de las páginas para responder:
                
                {pages_info}
                
                Además, te comparto las imágenes de las páginas que también debes analizar.
                
                Responde de manera concisa y directa a la consulta del usuario basándote en la información proporcionada (texto e imágenes).
                Si la información no está en el contenido (texto o imágenes) de las páginas, indícalo claramente.
                Incluye en tu respuesta a qué páginas específicas te refieres cuando cites información.
                Describe cualquier contenido visual relevante para la consulta.
            """
            
            # Crear array de partes para el modelo de visión
            parts = [
                {"text": prompt_consulta},
                *block_images
            ]
            
            try:
                # Usar timeout para evitar esperas infinitas
                resultado = await asyncio.wait_for(
                    model.generate_content_async(parts),
                    timeout=60  # 60 segundos máximo
                )
                texto_respuesta = resultado.text.strip()
                
                return jsonify({
                    'success': True,
                    'message': texto_respuesta,
                    'block': block_number,
                    'pageRange': f"{start_page + 1}-{end_page}",
                    'documentName': pdf_data['name'],
                    'totalBlocks': total_blocks
                })
            except asyncio.TimeoutError:
                logger.error(f"Timeout al procesar consulta para bloque {block_number}")
                return jsonify({
                    'success': False,
                    'message': f"La consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica o consulta otro bloque."
                })
            except Exception as error:
                logger.error(f"Error al procesar la consulta con imágenes: {error}")
                return jsonify({
                    'success': False,
                    'message': f"Error al procesar la consulta: {str(error)}"
                })

        # Verificar si es una consulta sobre una página específica
        page_regex = re.compile(r'^pagina\s+(\d+)\s*:\s*(.+)$', re.IGNORECASE)
        page_match = page_regex.match(query) if query else None

        if page_match and session_id:
            page_number = int(page_match.group(1))
            page_query = page_match.group(2).strip()
            
            pdf_data = pdf_store.get(session_id)
            if not pdf_data:
                return jsonify({
                    'success': False,
                    'message': 'No hay ningún PDF cargado para esta sesión. Por favor, sube un PDF primero.'
                })
            
            if page_number < 1 or page_number > pdf_data['totalPages']:
                return jsonify({
                    'success': False,
                    'message': f"El número de página debe estar entre 1 y {pdf_data['totalPages']}."
                })
            
            # Obtener el contenido y la imagen de la página
            page_content = pdf_data['pages'][page_number - 1]['text']
            page_image = {
                'inline_data': {
                    'data': pdf_data['pages'][page_number - 1]['fullPageImage'],
                    'mime_type': "image/png"
                }
            }
            
            # Construir el prompt para Gemini
            prompt_contexto = f"""
                Eres Briefly, un asistente virtual amigable y útil.
                La consulta del usuario es: "{page_query}"
                Esta consulta se refiere a la página {page_number} del documento "{pdf_data['name']}".
                
                Utiliza la siguiente información de la página {page_number} para responder:
                
                ---CONTENIDO TEXTUAL DE LA PÁGINA {page_number}---
                {page_content}
                ---FIN DEL CONTENIDO TEXTUAL---
                
                Además, te comparto una imagen de la página completa que también debes analizar.
                
                Responde de manera concisa y directa a la consulta del usuario basándote en la información proporcionada (texto e imagen).
                Si la información no está en el contenido de la página, indícalo claramente.
                Describe cualquier contenido visual relevante para la consulta.
            """
            
            # Crear array de partes para el modelo de visión
            parts = [
                {"text": prompt_contexto},
                page_image
            ]
            
            try:
                # Usar timeout para evitar esperas infinitas
                resultado = await asyncio.wait_for(
                    model.generate_content_async(parts),
                    timeout=60  # 60 segundos máximo
                )
                texto_respuesta = resultado.text.strip()
                
                return jsonify({
                    'success': True,
                    'message': texto_respuesta,
                    'page': page_number,
                    'documentName': pdf_data['name']
                })
            except asyncio.TimeoutError:
                logger.error(f"Timeout al procesar consulta para página {page_number}")
                return jsonify({
                    'success': False,
                    'message': f"La consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica."
                })
            except Exception as error:
                logger.error(f"Error al procesar la consulta con imagen: {error}")
                return jsonify({
                    'success': False,
                    'message': f"Error al procesar la consulta: {str(error)}"
                })
        
        # Si es una consulta general (no sobre un bloque o página específica)
        prompt_contexto = f"""
            Eres Briefly, un asistente virtual amigable y útil.
            La consulta del usuario es: "{query}"
            
            Responde de manera concisa y directa a la consulta del usuario.
            Si necesitas más información o contexto, solicítala amablemente.
            
            Si la consulta es sobre un documento PDF, recuérdale al usuario que:
            - Puede escribir "obtener resumen" para ver el resumen del bloque actual
            - Puede solicitar el siguiente bloque escribiendo "siguiente bloque"
            - Puede preguntar sobre un bloque específico usando "bloque X: tu pregunta"
            - Puede preguntar sobre una página específica usando "pagina X: tu pregunta"
            
            El sistema ahora también puede analizar imágenes y contenido visual en los PDFs.
        """
        
        try:
            # Usar timeout para evitar esperas infinitas
            resultado = await asyncio.wait_for(
                model.generate_content_async(prompt_contexto),
                timeout=30  # 30 segundos máximo para consultas generales
            )
            texto_respuesta = resultado.text.strip()
            
            return jsonify({
                'success': True,
                'message': texto_respuesta
            })
        except asyncio.TimeoutError:
            logger.error("Timeout al procesar consulta general")
            return jsonify({
                'success': False,
                'message': "La consulta está tomando demasiado tiempo. Por favor, intenta con una pregunta más específica."
            })

    except Exception as error:
        logger.error(f'Error general: {error}')
        return jsonify({
            'success': False,
            'message': f"Ocurrió un problema procesando tu consulta: {str(error)}"
        }), 500

# Endpoint para limpiar manualmente una sesión
@app.route('/api/sessions/<session_id>', methods=['DELETE'])
async def delete_session(session_id):
    if session_id in pdf_store:
        del pdf_store[session_id]
        if session_id in block_summary_control:
            del block_summary_control[session_id]
        logger.info(f"Sesión {session_id} eliminada manualmente")
        return jsonify({'success': True, 'message': f"Sesión {session_id} eliminada correctamente"})
    else:
        return jsonify({'success': False, 'message': 'Sesión no encontrada'}), 404

# Endpoint para obtener información de una sesión
@app.route('/api/sessions/<session_id>')
async def get_session_info(session_id):
    if session_id in pdf_store:
        pdf_data = pdf_store[session_id]
        control = block_summary_control.get(session_id, {})
        
        return jsonify({
            'success': True,
            'sessionInfo': {
                'documentName': pdf_data['name'],
                'totalPages': pdf_data['totalPages'],
                'totalBlocks': (pdf_data['totalPages'] + 2) // 3,
                'currentBlock': (control.get('lastBlock', 0) + 1),
                'createdAt': time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(pdf_data['timestamp']))
            }
        })
    else:
        return jsonify({'success': False, 'message': 'Sesión no encontrada'}), 404

# Endpoint para descargar la conversación
@app.route('/api/download-conversation', methods=['POST'])
async def download_conversation():
    try:
        data = await request.get_json()
        conversation = data.get('conversation', [])
        
        if not conversation:
            return jsonify({'success': False, 'message': 'No hay conversación para descargar'}), 400
        
        # Crear contenido del archivo
        content = "# Conversación con Briefly PDF Assistant\n"
        content += f"Fecha: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())}\n\n"
        
        session_id = data.get('sessionId')
        if session_id and session_id in pdf_store:
            pdf_data = pdf_store[session_id]
            content += f"Documento: {pdf_data['name']}\n"
            content += f"Páginas: {pdf_data['totalPages']}\n"
            content += f"Bloques: {(pdf_data['totalPages'] + 2) // 3}\n\n"
        
        content += "## Historial de conversación\n\n"
        
        for item in conversation:
            sender = item.get('sender', '')
            message = item.get('message', '')
            timestamp = item.get('timestamp', '')
            
            if timestamp:
                time_str = time.strftime('%H:%M:%S', time.localtime(timestamp))
            else:
                time_str = time.strftime('%H:%M:%S', time.localtime())
                
            sender_label = {
                'user': 'Usuario',
                'bot': 'Briefly',
                'system': 'Sistema'
            }.get(sender, sender)
            
            content += f"[{time_str}] {sender_label}: {message}\n\n"
        
        # Crear archivo temporal
        filename = f"Briefly_Conversacion_{time.strftime('%Y%m%d_%H%M%S')}.txt"
        filepath = os.path.join(os.getcwd(), 'temp', filename)
        
        # Asegurar que el directorio existe
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        # Guardar el archivo
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
            
        return jsonify({
            'success': True,
            'filename': filename,
            'filepath': filepath
        })
    except Exception as error:
        logger.error(f"Error al generar archivo de conversación: {error}")
        return jsonify({
            'success': False,
            'message': f"Error al generar archivo de conversación: {str(error)}"
        }), 500

# Endpoint para servir archivos temporales
@app.route('/api/download/<filename>')
async def download_file(filename):
    try:
        directory = os.path.join(os.getcwd(), 'temp')
        return await send_from_directory(directory, filename, as_attachment=True)
    except Exception as error:
        logger.error(f"Error al descargar archivo: {error}")
        return jsonify({
            'success': False,
            'message': f"Error al descargar archivo: {str(error)}"
        }), 500

# Servir archivos estáticos
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
async def serve_static(path):
    if not path:
        return await send_from_directory('static', 'index.html')
    return await send_from_directory('static', path)

# Función para limpiar PDFs antiguos
async def clean_old_sessions():
    while True:
        await asyncio.sleep(3600)  # Esperar una hora
        one_hour_ago = time.time() - 3600
        for session_id in list(pdf_store.keys()):
            if pdf_store[session_id]['timestamp'] < one_hour_ago:
                del pdf_store[session_id]
                if session_id in block_summary_control:
                    del block_summary_control[session_id]
                logger.info(f"Sesión {session_id} eliminada por inactividad")

# Iniciar proceso de limpieza en segundo plano
@app.before_serving
async def startup():
    # Crear directorio temporal si no existe
    os.makedirs(os.path.join(os.getcwd(), 'temp'), exist_ok=True)
    # Iniciar tarea de limpieza
    asyncio.create_task(clean_old_sessions())
    logger.info("Servidor iniciado y tareas de mantenimiento configuradas")

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3000))
    print(f"Servidor iniciado en http://0.0.0.0:{port}")
    print("Procesamiento de PDF con imágenes habilitado")
    import hypercorn.asyncio
    config = hypercorn.Config()
    config.bind = [f"0.0.0.0:{port}"]
    config.debug = True
    asyncio.run(hypercorn.asyncio.serve(app, config))

