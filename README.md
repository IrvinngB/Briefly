# **Briefly - AI PDF Assistant**

**Briefly** es una aplicación web innovadora que permite a los usuarios cargar documentos PDF, obtener resúmenes automáticos por bloques y realizar consultas específicas sobre el contenido del documento utilizando inteligencia artificial (IA). Es perfecta para estudiar, investigar o procesar rápidamente documentos largos.

![Briefly](https://via.placeholder.com/800x400?text=Briefly)

## **Características**

- 📄 **Carga y procesamiento de documentos PDF**: Sube tus archivos PDF de manera sencilla.
- 🤖 **Análisis de contenido con IA (Google Gemini)**: Resúmenes automáticos y análisis preciso del contenido.
- 📝 **Resúmenes automáticos por bloques de páginas**: El contenido se divide en bloques para obtener resúmenes claros y organizados.
- 🔍 **Consultas específicas sobre páginas o bloques**: Realiza preguntas precisas sobre cualquier parte del documento.
- 💬 **Interfaz de chat interactiva**: Habla con la IA y obtén respuestas instantáneas sobre el documento.
- 📱 **Diseño responsive**: Compatible con dispositivos móviles y de escritorio.
- 🌙 **Modo oscuro y claro**: Personaliza la interfaz según tus preferencias.
- 💾 **Descarga de conversaciones**: Guarda tus interacciones para revisarlas después.

## **Requisitos previos**

Asegúrate de tener las siguientes herramientas antes de empezar:

- Python 3.9 o superior
- Node.js 14 o superior (opcional, solo para desarrollo frontend)
- **Clave API de Google Gemini** (puedes obtenerla en la [plataforma de Google Cloud](https://cloud.google.com))
- **Flask** (para el desarrollo del backend)

## **Instalación**

Sigue estos pasos para instalar y ejecutar Briefly en tu máquina local:

### 1. **Clonar el repositorio**

```bash
git clone https://github.com/IrvinngB/Briefly.git
cd Briefly
```

### 2. **Crear y activar un entorno virtual**

Para asegurar que las dependencias se manejen de manera aislada, crea y activa un entorno virtual:

```bash
python -m venv venv
source venv/bin/activate  # En Windows usa `venv\Scripts\activate`
```

### 3. **Instalar dependencias**

Instala las dependencias necesarias para que la aplicación funcione, incluyendo Flask:

```bash
pip install -r requirements.txt
```

Si no tienes el archivo requirements.txt, puedes instalar Flask y otras dependencias manualmente:

```bash
pip install flask google-cloud-gemini quart
```

### 4. **Configurar variables de entorno**

Crea un archivo .env en el directorio raíz del proyecto y añade tu clave API de Google Gemini:

```ini
GEMINI_API_KEY=tu_clave_api
```

### 5. **Ejecutar la aplicación**

Inicia la aplicación con el siguiente comando:

```bash
quart run --reload
```

¡Listo! Ahora podrás acceder a Briefly y comenzar a usarla para procesar tus documentos PDF de manera eficiente.

## **Uso**

1. **Carga un documento PDF**: Selecciona tu archivo desde la interfaz de usuario.
2. **Interactúa con el documento**: Utiliza la interfaz de chat para hacer preguntas sobre cualquier parte del documento.
3. **Descarga las conversaciones**: Guarda las interacciones para referencia futura.

¡Disfruta usando Briefly y acelera tu procesamiento de documentos con inteligencia artificial!

## **Autor**

Desarrollado por Irvin Benitez.

Puedes contactarme en [irvin.benitezs.26@gmail.com] para cualquier consulta o sugerencia.

Visita mi perfil de GitHub: [IrvinngB](https://github.com/IrvinngB)
