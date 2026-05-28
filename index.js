const express = require("express");
const app = express();
app.use(express.json());

// ── CONFIGURACIÓN ─────────────────────────────────────────────
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN     || "feedlot2024";
const WA_TOKEN         = process.env.WA_TOKEN;
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;

// ── VERIFICACIÓN DEL WEBHOOK (Meta lo llama una vez al configurar) ──
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado OK");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── RECIBIR MENSAJES DE WHATSAPP ───────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from; // número del usuario
    const type = message.type;

    console.log(`Mensaje de ${from} — tipo: ${type}`);

    if (type === "text") {
      const texto = message.text.body.trim();
      await manejarTexto(from, texto);

    } else if (type === "image") {
      const imageId = message.image.id;
      const caption = message.image.caption || "";
      await manejarImagen(from, imageId, caption);

    } else {
      await enviarMensaje(from, "Por ahora solo proceso texto e imágenes. Mandame una foto de bosta o escribí los datos del corral.");
    }

  } catch (err) {
    console.error("Error procesando mensaje:", err);
  }
});

// ── MANEJAR MENSAJE DE TEXTO ───────────────────────────────────
async function manejarTexto(from, texto) {
  const textoLower = texto.toLowerCase();

  if (textoLower.includes("hola") || textoLower.includes("inicio") || textoLower === "menu") {
    await enviarMensaje(from,
      `🐄 *Diagnóstico de Establecimientos*\n\n` +
      `Hola! Soy el asistente veterinario IA para feedlots.\n\n` +
      `Podés:\n` +
      `📸 *Enviar una foto de bosta* → análisis de consistencia\n` +
      `📝 *Escribir datos del corral* → diagnóstico completo\n\n` +
      `Para diagnóstico escribí los datos así:\n` +
      `_Corral 5, 120 novillos, 280kg, 45 días, diarrea, severidad 7_`
    );
    return;
  }

  // Diagnóstico por texto libre con OpenAI
  await enviarMensaje(from, "🤔 Analizando... un momento.");

  const respuesta = await llamarOpenAI([
    {
      role: "system",
      content: `Sos un veterinario especialista en feedlots argentinos. 
El usuario te va a dar datos de un corral por WhatsApp. 
Respondé con un diagnóstico conciso y recomendaciones prácticas.
Usá formato simple para WhatsApp (sin markdown complejo, solo *negrita* para títulos).
Máximo 300 palabras.`
    },
    {
      role: "user",
      content: texto
    }
  ]);

  await enviarMensaje(from, respuesta);
}

// ── MANEJAR IMAGEN ─────────────────────────────────────────────
async function manejarImagen(from, imageId, caption) {
  await enviarMensaje(from, "📸 Recibí la foto, analizando...");

  // 1. Obtener URL de la imagen desde Meta
  const mediaRes = await fetch(`https://graph.facebook.com/v23.0/${imageId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
  const mediaData = await mediaRes.json();
  const imageUrl  = mediaData.url;

  // 2. Descargar la imagen
  const imgRes    = await fetch(imageUrl, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
  const imgBuffer = await imgRes.arrayBuffer();
  const base64    = Buffer.from(imgBuffer).toString("base64");
  const mimeType  = imgRes.headers.get("content-type") || "image/jpeg";

  // 3. Analizar con OpenAI Vision
  const respuesta = await llamarOpenAIVision(base64, mimeType, caption);

  await enviarMensaje(from, `💩 *Análisis de bosta:*\n\n${respuesta}`);
}

// ── LLAMAR A OPENAI (texto) ────────────────────────────────────
async function llamarOpenAI(messages) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model:      "gpt-4o-mini",
        max_tokens: 500,
        messages
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "No pude generar una respuesta.";
  } catch (err) {
    console.error("Error OpenAI:", err);
    return "Hubo un error al consultar la IA. Intentá de nuevo.";
  }
}

// ── LLAMAR A OPENAI VISION (imagen) ───────────────────────────
async function llamarOpenAIVision(base64, mimeType, caption) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model:      "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content: `Sos un veterinario especialista en feedlots argentinos. 
Analizá la foto de bosta que te mandan.
Evaluá: consistencia (líquida/chirle/indicada/pastosa/dura), color, fibra visible, grano sin digerir.
Respondé en formato simple para WhatsApp, conciso y práctico.
Máximo 200 palabras.`
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` }
              },
              {
                type: "text",
                text: caption ? `Contexto adicional: ${caption}` : "Analizá esta bosta de feedlot."
              }
            ]
          }
        ]
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "No pude analizar la imagen.";
  } catch (err) {
    console.error("Error OpenAI Vision:", err);
    return "Hubo un error al analizar la imagen.";
  }
}

// ── ENVIAR MENSAJE POR WHATSAPP ────────────────────────────────
async function enviarMensaje(to, texto) {
  try {
    await fetch(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${WA_TOKEN}`
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type:    "individual",
        to,
        type: "text",
        text: { body: texto }
      })
    });
  } catch (err) {
    console.error("Error enviando mensaje:", err);
  }
}

// ── INICIAR SERVIDOR ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
