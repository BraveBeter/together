"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, Search, X } from "lucide-react";
import { Button } from "../ui";
import type { PhotoLocation, PlaceResult } from "@/lib/photo-types";
const Earth = dynamic(() => import("./earth").then(m => m.Earth), { ssr: false });
export function LocationPicker({ value, onChange }: { value: PhotoLocation | null; onChange: (value: PhotoLocation | null) => void }) {
  const [q, setQ] = useState(""), [city, setCity] = useState(""), [results, setResults] = useState<PlaceResult[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [manual, setManual] = useState(false), [map, setMap] = useState(false);
  const [lat, setLat] = useState(value ? String(value.lat) : ""), [lng, setLng] = useState(value ? String(value.lng) : ""), [name, setName] = useState(value?.place ?? "");
  const choose = (location: PhotoLocation) => { setLat(String(location.lat)); setLng(String(location.lng)); setName(location.place); onChange(location); setResults([]); setError(""); };
  async function search() {
    setBusy(true); setError("");
    try { const r = await fetch(`/api/places/search?${new URLSearchParams({ q, city })}`); const body = await r.json(); if (!r.ok) throw new Error(body.error || "地点搜索失败"); setResults(body.items); if (!body.items.length) setError("没有找到，可以加上城市名称再试，或手动选点。"); }
    catch (e) { setError(e instanceof Error ? e.message : "搜索失败，输入已保留。"); } finally { setBusy(false); }
  }
  return <div className="location-picker">
    <span className="field-label">拍摄地点</span>
    {value && <div className="selected-location"><MapPin size={16} /><div><strong>{value.place || "已标注的位置"}</strong><small>{value.lat.toFixed(5)}, {value.lng.toFixed(5)} · {value.source === "exif" ? "照片 GPS" : "手动标注"}</small></div><button type="button" className="icon-button" aria-label="清除照片位置" onClick={() => { onChange(null); setLat(""); setLng(""); setName(""); }}><X size={16} /></button></div>}
    <div className="place-search"><input aria-label="地点名称" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索景点或地址" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} /><input aria-label="所在城市（选填）" value={city} onChange={e => setCity(e.target.value)} placeholder="城市（选填）" /><Button type="button" variant="secondary" busy={busy} onClick={() => void search()}><Search size={15} />查找</Button></div>
    {error && <p className="field-hint" role="alert">{error}</p>}
    {results.length > 0 && <ul className="place-results">{results.map(p => <li key={p.id}><button type="button" onClick={() => choose(p)}><MapPin size={15} /><span><strong>{p.place}</strong><small>{p.address}</small></span></button></li>)}</ul>}
    <button type="button" className="text-link" onClick={() => setManual(v => !v)}>{manual ? "收起手动定位" : "在地球上选点／填写经纬度"}</button>
    {manual && <div className="manual-location"><div className="form-row"><label className="field">纬度<input aria-label="纬度" type="number" min={-90} max={90} step="any" value={lat} onChange={e => setLat(e.target.value)} /></label><label className="field">经度<input aria-label="经度" type="number" min={-180} max={180} step="any" value={lng} onChange={e => setLng(e.target.value)} /></label></div><label className="field">地点备注<input aria-label="地点备注" value={name} maxLength={200} onChange={e => setName(e.target.value)} placeholder="给这个地方起个名字" /></label>
      <div className="inline-actions"><Button type="button" variant="secondary" onClick={() => { const a = Number(lat), b = Number(lng); if (!lat.trim() || !lng.trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) { setError("请填写有效的纬度（-90 到 90）和经度（-180 到 180）。"); return; } choose({ lat: a, lng: b, place: name, source: "manual" }); }}>使用这个位置</Button><button className="text-link" type="button" onClick={() => setMap(v => !v)}>{map ? "收起地球" : "打开地球选点"}</button></div>
      {map && <Earth compact points={[]} center={value} picking onPick={p => choose({ ...p, place: name, source: "manual" })} />}
    </div>}
  </div>;
}
