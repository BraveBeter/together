"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { demoSignIn, signIn } from "@/lib/actions";
import { Button, ErrorNotice } from "./ui";
export function Login({ demo }: { demo: boolean }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const router = useRouter();
  async function login(isDemo = false) { setBusy(true); setError(""); try { const result = await (isDemo ? demoSignIn() : signIn({ email, password })); if (!result.ok) setError(result.error); else { router.replace("/"); router.refresh(); } } catch { setError("暂时无法连接，请稍后再试。"); } finally { setBusy(false); } }
  return <main className="login-page"><section className="login-box"><div className="brand"><BrandMark size={38} /><span className="serif">同页</span></div><div className="login-intro"><h1 className="serif">电影、书，以及我们。</h1><p>登录后，继续收藏两个人的日常。</p></div><form onSubmit={e => { e.preventDefault(); void login(); }}><div className="field"><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="你的登录邮箱" required /></div><div className="field"><label htmlFor="password">密码</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div><ErrorNotice text={error} /><Button type="submit" busy={busy}>进入我们的空间 <ArrowRight size={16} /></Button></form><div className="login-private"><LockKeyhole size={12} />仅你们两人可见</div>{demo && <div className="demo-button"><button disabled={busy} onClick={() => { void login(true); }}><Sparkles size={13} />先逛逛演示空间<ArrowRight size={13} /></button></div>}</section></main>;
}
