document.addEventListener("DOMContentLoaded", () => {
    // Variables globales
    let currentSessionId = null
    let isProcessingQuery = false
    let isDarkMode = localStorage.getItem("darkMode") === "true"
    let conversationHistory = []
    let isWaitingForBlockSummary = false
    let blockSummaryRetries = 0
    const MAX_RETRIES = 10
    let isTyping = false // Variable para controlar la animación de tipeo
  
    // Elementos DOM
    const uploadForm = document.getElementById("upload-form")
    const pdfFileInput = document.getElementById("pdf-file")
    const fileNameDisplay = document.getElementById("file-name")
    const chatMessages = document.getElementById("chat-messages")
    const queryInput = document.getElementById("query-input")
    const sendButton = document.getElementById("send-button")
    const clearButton = document.getElementById("clear-input")
    const sessionInfo = document.getElementById("session-info")
    const docNameElement = document.getElementById("doc-name")
    const totalPagesElement = document.getElementById("total-pages")
    const totalBlocksElement = document.getElementById("total-blocks")
    const currentBlockElement = document.getElementById("current-block")
    const progressBar = document.getElementById("progress-bar")
    const loadingOverlay = document.getElementById("loading-overlay")
    const themeSwitch = document.getElementById("theme-switch")
    const toast = document.getElementById("toast")
    const downloadChatBtn = document.getElementById("download-chat")
    const clearChatBtn = document.getElementById("clear-chat")
    const commandsContainer = document.createElement("div") // Contenedor para botones de comandos
  
    // Inicializar tema
    if (isDarkMode) {
      document.body.classList.add("dark")
      themeSwitch.checked = true
    }
  
    // Configurar el contenedor de comandos
    commandsContainer.className = "commands-container"
    commandsContainer.innerHTML = `
      <div class="commands-title">Comandos rápidos:</div>
      <div class="commands-buttons">
        <button class="command-btn" data-command="obtener resumen">📄 Obtener resumen</button>
        <button class="command-btn" data-command="siguiente bloque">⏭️ Siguiente bloque</button>
        <button class="command-btn" data-command="bloque 1: resumen">📑 Bloque 1</button>
        <button class="command-btn" data-command="pagina 1: contenido">📃 Página 1</button>
      </div>
    `
  
    // Insertar comandos después del área de chat
    chatMessages.parentNode.insertBefore(commandsContainer, chatMessages.nextSibling)
  
    // Estilos CSS para los botones de comandos
    const style = document.createElement("style")
    style.textContent = `
      .commands-container {
        margin: 10px 0;
        padding: 10px;
        background-color: var(--secondary-bg);
        border-radius: 8px;
        box-shadow: var(--shadow-sm);
      }
      .commands-title {
        font-weight: bold;
        margin-bottom: 8px;
        color: var(--primary-color);
      }
      .commands-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .command-btn {
        background-color: var(--highlight-color);
        border: none;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        color: var(--text);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .command-btn:hover {
        background-color: var(--primary-color);
        color: white;
        transform: translateY(-2px);
      }
      .command-btn:active {
        transform: translateY(0);
      }
      .typing-text {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .download-btn, .clear-btn {
        display: flex;
        align-items: center;
        background-color: var(--secondary-bg);
        border: 1px solid var(--border-color);
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        margin: 5px 0;
        transition: all 0.2s ease;
      }
      .download-btn:hover, .clear-btn:hover {
        background-color: var(--highlight-color);
      }
      .download-btn i, .clear-btn i {
        margin-right: 5px;
      }
    `
    document.head.appendChild(style)
  
    // Event listeners para los botones de comandos
    document.querySelectorAll(".command-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const command = btn.getAttribute("data-command")
        if (command && !isProcessingQuery && !isTyping) {
          queryInput.value = command
          handleSendQuery()
        }
      })
    })
  
    // Event listeners
    pdfFileInput.addEventListener("change", handleFileSelect)
    uploadForm.addEventListener("submit", handleFormSubmit)
    sendButton.addEventListener("click", handleSendQuery)
    queryInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !isProcessingQuery && !isTyping) {
        handleSendQuery()
      }
    })
    queryInput.addEventListener("input", toggleClearButton)
    clearButton.addEventListener("click", clearInput)
    themeSwitch.addEventListener("change", toggleDarkMode)
    downloadChatBtn.addEventListener("click", downloadConversation)
    clearChatBtn.addEventListener("click", clearConversation)
  
    // Función para manejar la selección de archivo
    function handleFileSelect(e) {
      const file = e.target.files[0]
      if (file) {
        const fileName = file.name
        fileNameDisplay.textContent = fileName.length > 25 ? fileName.substring(0, 22) + "..." : fileName
  
        // Animar el contenedor del archivo
        const fileLabel = document.querySelector(".file-input-label")
        fileLabel.style.backgroundColor = "var(--highlight-color)"
        setTimeout(() => {
          fileLabel.style.backgroundColor = ""
        }, 300)
      } else {
        fileNameDisplay.textContent = "Ningún archivo seleccionado"
      }
    }
  
    // Función para manejar el envío del formulario (carga de PDF)
    async function handleFormSubmit(e) {
      e.preventDefault()
  
      const file = pdfFileInput.files[0]
      if (!file) {
        showToast("Por favor selecciona un archivo PDF", "error")
        return
      }
  
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        showToast("Solo se permiten archivos PDF", "error")
        return
      }
  
      // Mostrar overlay de carga solo para el procesamiento inicial del PDF
      loadingOverlay.classList.add("active")
  
      // Mostrar mensaje de carga inicial
      addSystemMessage("Cargando y procesando el PDF...")
  
      const formData = new FormData()
      formData.append("files", file)
  
      try {
        const response = await fetch("/api/query", {
          method: "POST",
          body: formData,
        })
  
        const data = await response.json()
  
        if (data.success) {
          // Guardar el ID de sesión y mostrar la información
          currentSessionId = data.sessionId
          updateSessionInfo(data)
  
          // Mostrar el contenedor de información de sesión
          sessionInfo.style.display = "block"
  
          // Verificar si el backend envía un array de mensajes o un solo mensaje
          if (Array.isArray(data.messages)) {
            // Si es un array, mostrar cada mensaje
            data.messages.forEach((message) => {
              addBotMessage(message, true) // true indica animación de tipeo
              saveToHistory("bot", message)
            })
          } else if (data.message) {
            // Si es un solo mensaje, mostrarlo
            addBotMessage(data.message, true) // true indica animación de tipeo
            saveToHistory("bot", data.message)
          }
  
          // Mostrar mensaje informativo sobre el resumen del primer bloque
          addSystemMessage("Generando resumen del primer bloque... (esto puede tomar hasta 1 minuto)")
          addSystemMessage("Puedes seguir interactuando con la aplicación mientras se genera el resumen.")
  
          // Actualizar los botones de comandos con datos reales
          updateCommandButtons(data.totalBlocks || (data.totalPages ? Math.ceil(data.totalPages / 3) : 3))
  
          // Iniciar un polling para obtener el resumen del primer bloque
          isWaitingForBlockSummary = true
          blockSummaryRetries = 0
          setTimeout(getBlockSummary, 2000)
  
          // Mostrar toast de éxito
          showToast("PDF cargado correctamente", "success")
  
          // Habilitar la entrada de texto
          queryInput.disabled = false
        } else {
          addBotMessage("Error: " + data.message || "No se pudo procesar el PDF")
          saveToHistory("bot", "Error: " + data.message || "No se pudo procesar el PDF")
          showToast("Error al procesar el PDF", "error")
        }
      } catch (error) {
        console.error("Error al cargar el PDF:", error)
        addBotMessage("Error al cargar el PDF. Por favor intenta de nuevo.")
        saveToHistory("bot", "Error al cargar el PDF. Por favor intenta de nuevo.")
        showToast("Error de conexión", "error")
      } finally {
        // Ocultar overlay de carga
        loadingOverlay.classList.remove("active")
      }
    }
  
    // Función para actualizar los botones de comandos
    function updateCommandButtons(totalBlocks) {
      const commandButtons = document.querySelector(".commands-buttons")
      if (!commandButtons) return
  
      // Mantener los primeros dos botones (obtener resumen y siguiente bloque)
      const firstTwoButtons = Array.from(commandButtons.querySelectorAll("button")).slice(0, 2)
  
      // Vaciar el contenedor
      commandButtons.innerHTML = ""
  
      // Añadir los primeros dos botones
      firstTwoButtons.forEach((btn) => commandButtons.appendChild(btn))
  
      // Añadir botones para bloques
      for (let i = 1; i <= Math.min(3, totalBlocks); i++) {
        const blockButton = document.createElement("button")
        blockButton.className = "command-btn"
        blockButton.setAttribute("data-command", `bloque ${i}: contenido`)
        blockButton.innerHTML = `📑 Bloque ${i}`
        commandButtons.appendChild(blockButton)
  
        blockButton.addEventListener("click", () => {
          if (!isProcessingQuery && !isTyping) {
            queryInput.value = `bloque ${i}: contenido`
            handleSendQuery()
          }
        })
      }
  
      // Añadir botones para páginas
      const totalPages = Number(totalPagesElement.textContent) || 6
      for (let i = 1; i <= Math.min(3, totalPages); i++) {
        const pageButton = document.createElement("button")
        pageButton.className = "command-btn"
        pageButton.setAttribute("data-command", `pagina ${i}: contenido`)
        pageButton.innerHTML = `📃 Página ${i}`
        commandButtons.appendChild(pageButton)
  
        pageButton.addEventListener("click", () => {
          if (!isProcessingQuery && !isTyping) {
            queryInput.value = `pagina ${i}: contenido`
            handleSendQuery()
          }
        })
      }
    }
  
    // Función para obtener el resumen del bloque actual
    async function getBlockSummary() {
      if (!currentSessionId || !isWaitingForBlockSummary) return
  
      // Incrementar contador de intentos
      blockSummaryRetries++
  
      // Si excedemos el número máximo de intentos, detenemos el polling
      if (blockSummaryRetries > MAX_RETRIES) {
        isWaitingForBlockSummary = false
        addSystemMessage(
          'No se pudo obtener el resumen automáticamente. Escribe "obtener resumen" para intentar nuevamente.',
        )
        saveToHistory(
          "system",
          'No se pudo obtener el resumen automáticamente. Escribe "obtener resumen" para intentar nuevamente.',
        )
        return
      }
  
      try {
        const formData = new FormData()
        formData.append("query", "obtener resumen")
        formData.append("sessionId", currentSessionId)
  
        const response = await fetch("/api/query", {
          method: "POST",
          body: formData,
        })
  
        const data = await response.json()
  
        if (data.success && data.isBlockSummary) {
          // Actualizar el bloque actual en la información de sesión
          if (currentBlockElement) {
            currentBlockElement.textContent = data.block
  
            // Actualizar barra de progreso
            if (data.totalBlocks) {
              updateProgressBar(data.block, data.totalBlocks)
            }
          }
  
          // Añadir el resumen al chat con animación de tipeo
          addBotMessage(data.message, true)
          saveToHistory("bot", data.message)
  
          // Ya no necesitamos seguir esperando
          isWaitingForBlockSummary = false
  
          // Mostrar mensaje informativo sobre cómo obtener más resúmenes
          addSystemMessage(
            'Para ver el resumen del siguiente bloque, escribe "siguiente bloque" o usa los botones de comandos',
          )
        } else if (data.success) {
          // Si aún no está listo el resumen, seguir esperando
          if (blockSummaryRetries % 3 === 0) {
            // Mostrar progreso cada 3 intentos
            addSystemMessage(`Aún generando el resumen... (intento ${blockSummaryRetries}/${MAX_RETRIES})`)
          }
          setTimeout(getBlockSummary, 2000)
        } else {
          console.log("No se pudo obtener el resumen:", data.message)
          // Aumentar el intervalo de reintento exponencialmente
          const retryDelay = Math.min(3000 * Math.pow(1.5, blockSummaryRetries - 1), 10000)
          setTimeout(getBlockSummary, retryDelay)
        }
      } catch (error) {
        console.error("Error al obtener el resumen:", error)
        // Aumentar el intervalo de reintento exponencialmente
        const retryDelay = Math.min(30000, 2000 * Math.pow(1.5, blockSummaryRetries - 1), 10000)
        setTimeout(getBlockSummary, retryDelay)
      }
    }
  
    // Add a new function to show loading progress for block summaries
    function updateLoadingProgress(current, total) {
      const percent = Math.round((current / total) * 100)
      const progressMessage = `Generando resumen... ${percent}% completado`
  
      // Buscar y actualizar el último mensaje de progreso, o crear uno nuevo
      const messages = chatMessages.getElementsByClassName("system-message")
      let lastProgressMessage = null
  
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].textContent.includes("Generando resumen...")) {
          lastProgressMessage = messages[i]
          break
        }
      }
  
      if (lastProgressMessage) {
        lastProgressMessage.textContent = progressMessage
      } else {
        addSystemMessage(progressMessage)
      }
    }
  
    // Función para manejar el envío de consultas
    async function handleSendQuery() {
      const query = queryInput.value.trim()
  
      if (!query) return
      if (isProcessingQuery || isTyping) {
        showToast("Espera a que se complete la consulta actual", "warning")
        return
      }
  
      // Mostrar mensaje del usuario
      addUserMessage(query)
      saveToHistory("user", query)
  
      // Limpiar input y deshabilitar mientras procesa
      queryInput.value = ""
      clearButton.style.display = "none"
      isProcessingQuery = true
  
      // Añadir efecto de "escribiendo..." para el bot
      const typingIndicator = addTypingIndicator()
  
      try {
        const formData = new FormData()
        formData.append("query", query)
  
        if (currentSessionId) {
          formData.append("sessionId", currentSessionId)
        }
  
        const response = await fetch("/api/query", {
          method: "POST",
          body: formData,
        })
  
        const data = await response.json()
  
        // Eliminar el indicador de escritura
        if (typingIndicator) {
          typingIndicator.remove()
        }
  
        if (data.success) {
          // Añadir respuesta con animación de tipeo
          addBotMessage(data.message, true)
          saveToHistory("bot", data.message)
  
          // Si la respuesta contiene información sobre bloques, actualizar
          if (data.processingBlock) {
            updateBlockInfo(data)
            updateProgressBar(data.processingBlock, data.totalBlocks)
  
            // Si está procesando un bloque, iniciar polling para obtener el resumen
            isWaitingForBlockSummary = true
            blockSummaryRetries = 0
            setTimeout(getBlockSummary, 2000)
          }
  
          // Si es una consulta sobre un bloque específico
          if (data.block) {
            updateBlockInfo({ currentBlock: data.block })
            updateProgressBar(data.block, data.totalBlocks)
          }
  
          // Si está completo el documento
          if (data.complete) {
            addSystemMessage("Procesamiento del documento completo")
            saveToHistory("system", "Procesamiento del documento completo")
            showToast("Documento procesado completamente", "success")
          }
        } else {
          addBotMessage("Error: " + data.message)
          saveToHistory("bot", "Error: " + data.message)
          showToast("Error al procesar la consulta", "error")
        }
      } catch (error) {
        console.error("Error al procesar la consulta:", error)
        addBotMessage("Error al procesar tu consulta. Por favor intenta de nuevo.")
        saveToHistory("bot", "Error al procesar tu consulta. Por favor intenta de nuevo.")
        showToast("Error de conexión", "error")
  
        // Eliminar el indicador de escritura si aún existe
        if (typingIndicator) {
          typingIndicator.remove()
        }
      } finally {
        isProcessingQuery = false
        queryInput.focus()
      }
    }
  
    // Función para añadir indicador de "escribiendo..."
    function addTypingIndicator() {
      const typingDiv = document.createElement("div")
      typingDiv.className = "message bot-message typing-indicator"
      typingDiv.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'
  
      // Añadir estilos para los puntos
      const style = document.createElement("style")
      style.textContent = `
              .typing-indicator {
                  padding: 10px 20px;
              }
              .typing-indicator .dot {
                  display: inline-block;
                  width: 8px;
                  height: 8px;
                  border-radius: 50%;
                  background-color: var(--dark-gray);
                  margin: 0 3px;
                  animation: typingAnimation 1.4s infinite ease-in-out both;
              }
              .typing-indicator .dot:nth-child(1) {
                  animation-delay: -0.32s;
              }
              .typing-indicator .dot:nth-child(2) {
                  animation-delay: -0.16s;
              }
              @keyframes typingAnimation {
                  0%, 80%, 100% { transform: scale(0); }
                  40% { transform: scale(1.0); }
              }
          `
      document.head.appendChild(style)
  
      chatMessages.appendChild(typingDiv)
      chatMessages.scrollTop = chatMessages.scrollHeight
  
      return typingDiv
    }
  
    // Función para añadir mensaje del usuario al chat
    function addUserMessage(text) {
      const messageDiv = document.createElement("div")
      messageDiv.className = "message user-message"
      messageDiv.textContent = text
      chatMessages.appendChild(messageDiv)
      chatMessages.scrollTop = chatMessages.scrollHeight
    }
  
    // Función para añadir mensaje del bot al chat con animación de tipeo opcional
    function addBotMessage(text, withTypingAnimation = false) {
      const messageDiv = document.createElement("div")
      messageDiv.className = "message bot-message"
  
      if (withTypingAnimation) {
        isTyping = true
        messageDiv.classList.add("typing-text")
        messageDiv.textContent = ""
        chatMessages.appendChild(messageDiv)
  
        // Velocidad de tipeo (caracteres por segundo)
        const charsPerSecond = 30
        const minDuration = 1500 // Al menos 1.5 segundos para mensajes cortos
        const maxDuration = 8000 // No más de 8 segundos para mensajes largos
  
        // Calcular la duración basada en la longitud del texto
        let duration = (text.length / charsPerSecond) * 1000
        duration = Math.max(minDuration, Math.min(duration, maxDuration))
  
        let i = 0
        const interval = setInterval(() => {
          if (i < text.length) {
            messageDiv.textContent += text.charAt(i)
            chatMessages.scrollTop = chatMessages.scrollHeight
            i++
          } else {
            clearInterval(interval)
            isTyping = false
          }
        }, duration / text.length)
      } else {
        messageDiv.textContent = text
        chatMessages.appendChild(messageDiv)
      }
  
      chatMessages.scrollTop = chatMessages.scrollHeight
    }
  
    // Función para añadir mensaje del sistema
    function addSystemMessage(text) {
      const messageDiv = document.createElement("div")
      messageDiv.className = "system-message"
      messageDiv.textContent = text
      chatMessages.appendChild(messageDiv)
      chatMessages.scrollTop = chatMessages.scrollHeight
    }
  
    // Función para guardar mensajes en el historial
    function saveToHistory(sender, message) {
      const timestamp = new Date().toISOString()
      conversationHistory.push({
        sender,
        message,
        timestamp,
      })
    }
  
    // Función para descargar la conversación
    function downloadConversation() {
      if (conversationHistory.length === 0) {
        showToast("No hay conversación para descargar", "warning")
        return
      }
  
      // Mostrar indicador de carga
      showToast("Preparando la descarga...", "info")
  
      // Intentar usar el endpoint del backend si existe
      if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        // Para servidores remotos, intentar usar el endpoint del backend
        try {
          fetch("/api/download-conversation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sessionId: currentSessionId,
              conversation: conversationHistory,
            }),
          })
            .then((response) => response.json())
            .then((data) => {
              if (data.success && data.filename) {
                // Redirigir a la URL de descarga
                window.location.href = `/api/download/${data.filename}`
                showToast("Conversación descargada correctamente", "success")
              } else {
                // Si falla, usar el método del cliente
                downloadConversationClient()
              }
            })
            .catch((error) => {
              console.error("Error al descargar conversación:", error)
              // Si falla, usar el método del cliente
              downloadConversationClient()
            })
        } catch (error) {
          console.error("Error al intentar descargar:", error)
          // Si falla, usar el método del cliente
          downloadConversationClient()
        }
      } else {
        // Para desarrollo local, usar siempre el método del cliente
        downloadConversationClient()
      }
    }
  
    // Añadir esta nueva función para descargar en el cliente
    function downloadConversationClient() {
      // Crear contenido del archivo
      let content = "# Conversación con Briefly PDF Assistant\n"
      content += `Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`
  
      if (currentSessionId && docNameElement.textContent !== "-") {
        content += `Documento: ${docNameElement.textContent}\n`
        content += `Páginas: ${totalPagesElement.textContent}\n`
        content += `Bloques: ${totalBlocksElement.textContent}\n\n`
      }
  
      content += "## Historial de conversación\n\n"
  
      conversationHistory.forEach((item) => {
        const time = new Date(item.timestamp).toLocaleTimeString()
        let sender = ""
  
        switch (item.sender) {
          case "user":
            sender = "Usuario"
            break
          case "bot":
            sender = "Briefly"
            break
          case "system":
            sender = "Sistema"
            break
        }
  
        content += `[${time}] ${sender}: ${item.message}\n\n`
      })
  
      // Crear blob y descargar
      const blob = new Blob([content], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
  
      // Generar nombre de archivo con fecha y hora
      const date = new Date()
      const fileName = `Briefly_Conversacion_${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}_${date.getHours().toString().padStart(2, "0")}-${date.getMinutes().toString().padStart(2, "0")}.txt`
  
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
  
      // Limpiar
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 100)
  
      showToast("Conversación descargada correctamente", "success")
    }
  
    // Función para limpiar la conversación
    function clearConversation() {
      if (chatMessages.children.length === 0) {
        showToast("No hay mensajes para limpiar", "warning")
        return
      }
  
      if (confirm("¿Estás seguro de que deseas limpiar toda la conversación?")) {
        // Guardar el mensaje inicial
        const initialMessage = conversationHistory.length > 0 ? conversationHistory[0] : null
  
        // Limpiar chat y historial
        chatMessages.innerHTML = ""
        conversationHistory = []
  
        // Restaurar mensaje inicial si existía
        if (initialMessage && initialMessage.sender === "bot") {
          addBotMessage(initialMessage.message)
          saveToHistory("bot", initialMessage.message)
        } else {
          // Añadir mensaje de bienvenida
          const welcomeMessage =
            "¡Hola! Soy Briefly, un asistente para analizar documentos PDF. Para comenzar, carga un PDF y podré ayudarte a extraer información, resumir su contenido y responder preguntas sobre él."
          addBotMessage(welcomeMessage)
          saveToHistory("bot", welcomeMessage)
        }
  
        showToast("Conversación limpiada correctamente", "success")
      }
    }
  
    // Función para mostrar toast
    function showToast(message, type = "info") {
      toast.textContent = message
      toast.className = "toast " + type
  
      // Añadir clase para mostrar
      setTimeout(() => {
        toast.classList.add("show")
      }, 10)
  
      // Ocultar después de 3 segundos
      setTimeout(() => {
        toast.classList.remove("show")
      }, 3000)
    }
  
    // Función para actualizar la información de la sesión
    function updateSessionInfo(data) {
      if (sessionInfo && data) {
        sessionInfo.style.display = "block"
  
        if (data.sessionId) {
          // Si tenemos un nuevo ID de sesión, cargar la información completa
          fetch(`/api/sessions/${data.sessionId}`)
            .then((response) => response.json())
            .then((sessionData) => {
              if (sessionData.success && sessionData.sessionInfo) {
                const info = sessionData.sessionInfo
  
                if (docNameElement) docNameElement.textContent = info.documentName || "Sin nombre"
                if (totalPagesElement) totalPagesElement.textContent = info.totalPages || "0"
                if (totalBlocksElement) totalBlocksElement.textContent = info.totalBlocks || "0"
                if (currentBlockElement) currentBlockElement.textContent = info.currentBlock || "1"
  
                // Actualizar barra de progreso
                updateProgressBar(info.currentBlock, info.totalBlocks)
  
                // Actualizar botones de comandos con datos reales
                updateCommandButtons(info.totalBlocks || 3)
              }
            })
            .catch((error) => {
              console.error("Error al cargar info de sesión:", error)
              showToast("Error al cargar información de sesión", "error")
            })
        } else {
          // Actualizar con la información directa
          if (data.totalPages && totalPagesElement) totalPagesElement.textContent = data.totalPages
          if (data.totalBlocks && totalBlocksElement) totalBlocksElement.textContent = data.totalBlocks
        }
      }
    }
  
    // Función para actualizar la información del bloque actual
    function updateBlockInfo(data) {
      if (currentBlockElement && data.processingBlock) {
        currentBlockElement.textContent = data.processingBlock
      } else if (currentBlockElement && data.currentBlock) {
        currentBlockElement.textContent = data.currentBlock
      }
    }
  
    // Función para actualizar la barra de progreso
    function updateProgressBar(currentBlock, totalBlocks) {
      if (progressBar && currentBlock && totalBlocks) {
        const progress = (Number.parseInt(currentBlock) / Number.parseInt(totalBlocks)) * 100
        progressBar.style.width = `${progress}%`
      }
    }
  
    // Función para mostrar/ocultar el botón de limpiar
    function toggleClearButton() {
      if (queryInput.value.length > 0) {
        clearButton.style.display = "block"
      } else {
        clearButton.style.display = "none"
      }
    }
  
    // Función para limpiar el input
    function clearInput() {
      queryInput.value = ""
      clearButton.style.display = "none"
      queryInput.focus()
    }
  
    // Función para cambiar entre modo claro y oscuro
    function toggleDarkMode() {
      isDarkMode = !isDarkMode
      document.body.classList.toggle("dark", isDarkMode)
      localStorage.setItem("darkMode", isDarkMode)
    }
  
    // Mejorar la apariencia de los botones de descargar y limpiar
    downloadChatBtn.className = "download-btn"
    downloadChatBtn.innerHTML = '<i class="fas fa-download"></i> Descargar conversación'
    clearChatBtn.className = "clear-btn"
    clearChatBtn.innerHTML = '<i class="fas fa-trash"></i> Limpiar chat'
  
    // Mensaje inicial
    addBotMessage(
      "¡Hola! Soy Briefly, un asistente para analizar documentos PDF. Para comenzar, carga un PDF y podré ayudarte a extraer información, resumir su contenido y responder preguntas sobre él.",
      true, // Usar animación de tipeo
    )
    saveToHistory(
      "bot",
      "¡Hola! Soy Briefly, un asistente para analizar documentos PDF. Para comenzar, carga un PDF y podré ayudarte a extraer información, resumir su contenido y responder preguntas sobre él.",
    )
  
    // Añadir animación al botón de enviar
    sendButton.addEventListener("mousedown", function () {
      this.style.transform = "scale(0.95)"
    })
  
    sendButton.addEventListener("mouseup", function () {
      this.style.transform = ""
    })
  
    // Detectar si el usuario está en un dispositivo móvil
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
    // Ajustar la interfaz para dispositivos móviles
    if (isMobile) {
      const sidebar = document.querySelector(".sidebar")
      const mainContent = document.querySelector(".main-content")
  
      // Crear botón para mostrar/ocultar sidebar en móvil
      const toggleButton = document.createElement("button")
      toggleButton.className = "mobile-toggle"
      toggleButton.innerHTML = '<i class="fas fa-bars"></i>'
      toggleButton.style.cssText = `
              position: fixed;
              top: 15px;
              left: 15px;
              z-index: 100;
              background-color: var(--primary-color);
              color: white;
              border: none;
              width: 40px;
              height: 40px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: var(--shadow-md);
          `
  
      document.body.appendChild(toggleButton)
  
      // Ocultar sidebar por defecto en móvil
      sidebar.style.transform = "translateX(-100%)"
      sidebar.style.position = "fixed"
      sidebar.style.height = "100%"
      sidebar.style.zIndex = "99"
  
      // Evento para mostrar/ocultar sidebar
      toggleButton.addEventListener("click", () => {
        if (sidebar.style.transform === "translateX(0px)") {
          sidebar.style.transform = "translateX(-100%)"
        } else {
          sidebar.style.transform = "translateX(0)"
        }
      })
  
      // Cerrar sidebar al hacer clic fuera de ella
      mainContent.addEventListener("click", () => {
        if (sidebar.style.transform === "translateX(0px)") {
          sidebar.style.transform = "translateX(-100%)"
        }
      })
  
      // Ajustar comandos para mejor visualización en móvil
      commandsContainer.style.flexDirection = "column"
      document.querySelectorAll(".command-btn").forEach((btn) => {
        btn.style.width = "100%"
      })
    }
  })
  
  