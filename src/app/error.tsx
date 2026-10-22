"use client";
export default function Error({ reset }: { reset: () => void }) { return <main className="standalone-state"><h1 className="serif">这一页，暂时没能打开</h1><p>请稍后再试。已经保存的回忆还在。</p><button className="button primary" onClick={reset}>重新打开</button></main>; }
