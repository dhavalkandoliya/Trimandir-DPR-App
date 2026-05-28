import './globals.css';

export const metadata = {
  title: 'Site DPR — Man Power Report',
  description: 'Trust Project Department',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
