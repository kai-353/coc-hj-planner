import { useEffect, useState } from "react";
import "./index.css";

export function App() {
  const [meta, setMeta] = useState<unknown>(null);
  useEffect(() => {
    fetch("/api/meta").then((r) => r.json()).then(setMeta);
  }, []);
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-2xl font-semibold">Hammer Jam Planner</h1>
      <pre className="text-xs">{JSON.stringify(meta, null, 2)}</pre>
    </main>
  );
}
