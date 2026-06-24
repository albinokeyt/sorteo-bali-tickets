// Plantilla de email por defecto (se siembra en la BD la primera vez).
// Después se edita desde el panel admin sin redesplegar.
//
// Variables disponibles (se reemplazan al enviar):
//   {{name}}           nombre del comprador
//   {{email}}          email del comprador
//   {{count}}          nº de tickets de esta compra
//   {{raffle_name}}    nombre del sorteo
//   {{product}}        producto comprado (si se mapea desde GHL)
//   {{confirmation_id}} código del primer ticket / id de compra
//   {{ticket_numbers}} lista de números, ej: "#12, #13, #14"
//   {{link_acceso}}    URL "Accede a tus productos" (LinkAcceso de GHL)
//   {{whatsapp_url}}   URL del botón de WhatsApp
//   {{tickets_url}}    página web para ver los tickets
//   {{tickets_html}}   bloque con la imagen de cada ticket (quítalo si no lo quieres)
//   {{preheader}}      texto de vista previa (oculto)

export const DEFAULT_EMAIL = {
  from_email: "tickets@tudominio.com",
  from_name: "Movimiento Real",
  subject: "🎫 {{name}}, tu Ticket Dorado para Bali ya está aquí",
  preheader: "Tu Guía está lista y tienes {{count}} ticket(s) en el sorteo del Retiro Real en Bali 2026.",
  whatsapp_url: "https://wa.me/34919930715",
  html: `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Tu Ticket Dorado – Movimiento Real</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background-color: #1a1a18; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
  .email-wrapper { background-color: #1a1a18; padding: 32px 16px; }
  .email-container { max-width: 600px; margin: 0 auto; background-color: #1a1a18; overflow: hidden; }
  .header { background: linear-gradient(160deg, #1e1e1b 0%, #111110 100%); padding: 48px 40px 40px; text-align: center; border-bottom: 1px solid #2e2c27; }
  .header::before { content: ''; display: block; width: 48px; height: 3px; background: linear-gradient(90deg, #C9A227, #e8c456); margin: 0 auto 28px; border-radius: 2px; }
  .brand-name { font-family: 'Playfair Display', Georgia, serif; font-size: 30px; font-weight: 800; letter-spacing: 3px; color: #C9A227; text-transform: uppercase; line-height: 1.2; margin-bottom: 10px; }
  .brand-tagline { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500; letter-spacing: 2.5px; color: #7a7a6e; text-transform: uppercase; }
  .body-section { background-color: #f5f2ec; padding: 48px 40px 0; }
  .greeting { font-family: 'Playfair Display', Georgia, serif; font-size: 26px; font-weight: 700; color: #1a1a18; line-height: 1.3; margin-bottom: 18px; }
  .greeting .name { color: #4a5d3a; }
  .intro-text { font-size: 15px; line-height: 1.9; color: #4a4a44; margin-bottom: 0; padding-bottom: 36px; border-bottom: 1px solid #e0dbd0; }
  .intro-text strong { color: #1a1a18; font-weight: 600; }
  .ticket-section { background-color: #f5f2ec; padding: 32px 40px; }
  .ticket-card { background: #1a1a18; border-radius: 12px; overflow: hidden; position: relative; }
  .ticket-card::before { content: ''; display: block; height: 4px; background: linear-gradient(90deg, #C9A227 0%, #e8c456 50%, #C9A227 100%); }
  .ticket-inner { padding: 28px 30px; display: flex; align-items: stretch; gap: 0; }
  .ticket-left { flex: 1; padding-right: 24px; border-right: 1px dashed #333330; }
  .ticket-label { font-size: 10px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #C9A227; margin-bottom: 6px; }
  .ticket-title { font-family: 'Playfair Display', Georgia, serif; font-size: 20px; font-weight: 700; color: #f5f2ec; margin-bottom: 20px; line-height: 1.3; }
  .ticket-field-label { font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #5a5a52; margin-bottom: 4px; }
  .ticket-id { font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #8a8a7e; letter-spacing: 0.5px; line-height: 1.6; word-break: break-all; }
  .ticket-right { padding-left: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 90px; text-align: center; }
  .ticket-count { font-family: 'Playfair Display', Georgia, serif; font-size: 48px; font-weight: 800; color: #C9A227; line-height: 1; margin-bottom: 4px; }
  .ticket-count-label { font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: #5a5a52; line-height: 1.4; }
  .tickets-imgs { background:#f5f2ec; padding: 0 40px 8px; }
  .tickets-imgs img { display:block; width:100%; max-width:520px; margin:0 auto 14px; border-radius:10px; border:1px solid #e0dbd0; }
  .products-section { background-color: #f5f2ec; padding: 24px 40px 32px; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; color: #8a8a7e; margin-bottom: 16px; text-align:center; }
  .product-card { background: #fff; border: 1px solid #e0dbd0; border-left: 3px solid #4a5d3a; border-radius: 8px; padding: 20px 22px; }
  .product-name { font-size: 15px; font-weight: 600; color: #1a1a18; margin-bottom: 8px; line-height: 1.4; }
  .product-desc { font-size: 13px; color: #6a6a60; line-height: 1.7; }
  .notice-section { background-color: #f5f2ec; padding: 0 40px 36px; }
  .notice-card { background: #fffaf0; border: 1px solid #e8c870; border-radius: 8px; padding: 18px 22px; display: flex; gap: 14px; align-items: flex-start; }
  .notice-icon { font-size: 18px; flex-shrink: 0; line-height: 1.6; }
  .notice-title { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #b8860b; margin-bottom: 6px; }
  .notice-text { font-size: 13px; color: #5a5040; line-height: 1.7; }
  .notice-text strong { color: #1a1a18; font-weight: 600; }
  .cta-section { background-color: #f5f2ec; padding: 0 40px 48px; }
  .cta-btn { display: block; width: 100%; padding: 16px 32px; border-radius: 6px; font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; text-decoration: none; text-align: center; margin-bottom: 12px; }
  .cta-primary { background: #C9A227; color: #1a1a18; }
  .cta-whatsapp { background: #25D366; color: #fff; }
  .cta-tickets { background: transparent; color: #4a5d3a; border: 2px solid #4a5d3a; }
  .footer { background: #111110; padding: 36px 40px; text-align: center; border-top: 1px solid #2e2c27; }
  .footer::before { content: ''; display: block; width: 32px; height: 2px; background: #C9A227; margin: 0 auto 24px; opacity: 0.5; }
  .footer-brand { font-family: 'Playfair Display', Georgia, serif; font-size: 16px; font-weight: 700; letter-spacing: 3px; color: #C9A227; text-transform: uppercase; margin-bottom: 8px; }
  .footer-pillars { font-size: 11px; letter-spacing: 1px; color: #4a4a40; margin-bottom: 24px; line-height: 1.6; }
  .footer-links { font-size: 12px; }
  .footer-links a { color: #5a5a50; text-decoration: none; margin: 0 12px; letter-spacing: 0.5px; }
  @media only screen and (max-width: 480px) {
    .email-wrapper { padding: 0; }
    .header, .body-section, .ticket-section, .products-section, .notice-section, .cta-section, .footer, .tickets-imgs { padding-left: 24px; padding-right: 24px; }
    .ticket-inner { flex-direction: column; gap: 20px; }
    .ticket-left { border-right: none; border-bottom: 1px dashed #333330; padding-right: 0; padding-bottom: 20px; }
    .ticket-right { padding-left: 0; flex-direction: row; gap: 12px; align-items: center; justify-content: flex-start; }
    .ticket-count { font-size: 36px; }
    .brand-name { font-size: 24px; letter-spacing: 2px; }
    .greeting { font-size: 22px; }
  }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{{preheader}}</div>
<div class="email-wrapper">
<div class="email-container">

  <div class="header">
    <div class="brand-name">Movimiento Real</div>
    <div class="brand-tagline">Retiro Bali 2026 &nbsp;·&nbsp; Sorteo Mundial</div>
  </div>

  <div class="body-section">
    <div class="greeting">¡Hola, <span class="name">{{name}}</span>!</div>
    <p class="intro-text">
      Felicidades por dar el primer paso hacia una versión más fuerte de ti. Tu <strong>{{product}}</strong> está lista, y con ella, tu Ticket Dorado para el sorteo de la plaza nº11 del Retiro Real en Bali 2026.
    </p>
  </div>

  <div class="ticket-section">
    <div class="ticket-card">
      <div class="ticket-inner">
        <div class="ticket-left">
          <div class="ticket-label">🎫 Tu Ticket Dorado</div>
          <div class="ticket-title">Retiro Real<br>Bali 2026</div>
          <div class="ticket-field-label">Número de confirmación</div>
          <div class="ticket-id">{{confirmation_id}}</div>
        </div>
        <div class="ticket-right">
          <div class="ticket-count">{{count}}</div>
          <div class="ticket-count-label">ticket(s) en<br>el sorteo</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Imagen de cada ticket. Quita {{tickets_html}} si no quieres las imágenes en el email. -->
  <div class="tickets-imgs">{{tickets_html}}</div>

  <div class="products-section">
    <div class="section-title">📚 Tus Productos</div>
    <div class="product-card">
      <div class="product-name">{{product}}</div>
      <div class="product-desc">Accede a todo tu contenido desde el botón de abajo. Cada producto que compres suma más tickets al sorteo.</div>
    </div>
  </div>

  <div class="notice-section">
    <div class="notice-card">
      <div class="notice-icon">⚠️</div>
      <div>
        <div class="notice-title">Importante</div>
        <p class="notice-text">Guarda este email. Cada producto que compres incluye tickets para el sorteo. Cuantos más tengas, más posibilidades. El ganador se anunciará el <strong>3 de julio de 2026</strong> ante notario.</p>
      </div>
    </div>
  </div>

  <div class="cta-section">
    <a href="{{link_acceso}}" class="cta-btn cta-primary">📥 Acceder a mis productos</a>
    <a href="{{whatsapp_url}}" class="cta-btn cta-whatsapp">💬 Contactar por WhatsApp</a>
    <a href="{{tickets_url}}" class="cta-btn cta-tickets">🎟️ Ver mis tickets</a>
  </div>

  <div class="footer">
    <div class="footer-brand">Movimiento Real</div>
    <div class="footer-pillars">Nutrición Natural · Entrenamiento Consciente · Relaciones de Calidad</div>
    <div class="footer-links">
      <a href="#">Instagram</a>
      <a href="#">Política de Privacidad</a>
      <a href="#">Contacto</a>
    </div>
  </div>

</div>
</div>
</body>
</html>`,
};
