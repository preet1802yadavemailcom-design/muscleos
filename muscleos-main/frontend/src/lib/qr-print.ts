/** Opens a print window showing the QR canvas image, sized for a wall poster. */
export function printQrCode(canvas: HTMLCanvasElement) {
  const url = canvas.toDataURL('image/png');
  const win = window.open('', '_blank', 'width=600,height=700');
  if (!win) return;
  win.document.write(`
    <html>
      <head>
        <title>Gym Check-in QR</title>
        <style>
          body { display: flex; flex-direction: column; align-items: center; justify-content: center;
                 min-height: 100vh; margin: 0; font-family: Arial, sans-serif; }
          img { width: 420px; height: 420px; }
          h2 { margin: 16px 0 4px; }
          p { color: #666; margin: 0 0 24px; }
          @media print { body { min-height: auto; } }
        </style>
      </head>
      <body>
        <h2>Scan to check in</h2>
        <p>MuscleOS — gym entry QR</p>
        <img src="${url}" />
        <script>window.onload = () => { setTimeout(() => window.print(), 250); };</script>
      </body>
    </html>
  `);
  win.document.close();
}
