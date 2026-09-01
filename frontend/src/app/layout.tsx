import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@/styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pulse AI",
    template: "%s | Pulse AI",
  },
  description: "Pulse AI workforce management platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
