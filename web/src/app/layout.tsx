import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Raleway } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import { cn } from "@/lib/utils";

const raleway = Raleway({subsets:['latin'],variable:'--font-sans'});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: 'TrackFlow',
    template: '%s | TrackFlow',
  },
  description: 'Professional workforce time tracking and monitoring',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(jetbrainsMono.variable, "font-sans", raleway.variable)}>
      <body className="antialiased bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
