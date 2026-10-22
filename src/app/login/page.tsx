import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { demoEnabled } from "@/lib/config";
import { Login } from "@/components/login";
export const dynamic = "force-dynamic";
export default async function LoginPage() { if (await currentMember()) redirect("/"); return <Login demo={demoEnabled} />; }
