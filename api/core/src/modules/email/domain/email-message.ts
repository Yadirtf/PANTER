/** Correo transaccional listo para enviar. `text` es obligatorio: siempre hay versión plana. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
