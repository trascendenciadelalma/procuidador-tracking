export const metadata = {
  title: 'AdsBoard — Sistema Pro Cuidador',
  description: 'Tracking y atribución en tiempo real',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
