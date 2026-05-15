import "./globals.css";
import { satoshi, cinzel } from "@/lib/fonts";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";

export const metadata = {
  title: "WREDD Dashboard",
  description: "Internal Project & Workforce Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${satoshi.variable} ${cinzel.variable}`}
    >
      <body className="font-sans antialiased">
       <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          value={{ light: "light", dark: "dark", system: "system" }}
        >
          {children}
          <Toaster
            position="top-right"
            richColors
            closeButton
            duration={4000}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
