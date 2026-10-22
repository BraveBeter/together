import type { Metadata, Viewport } from "next";
import { StarryBackground } from "@/components/starry-background";
import "@fontsource-variable/noto-serif-sc";
import "./globals.css";
import "./starry-background.css";
import "./catalog-picker.css";
import "./collections.css";
import "./photos.css";

export const metadata: Metadata = { title: { default: "同页 · 两个人的生活收藏", template: "%s · 同页" }, description: "电影、书，以及我们。把一起度过的时光，慢慢收藏。", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#111313" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN" data-scroll-behavior="smooth"><body><StarryBackground />{children}</body></html>; }
