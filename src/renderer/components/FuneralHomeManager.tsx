import { useState } from "react";

import type { FuneralHomeOption } from "@/shared/contracts";

interface Props {
  homes: FuneralHomeOption[];
  onUpdate: (homes: FuneralHomeOption[]) => void;
}

export function FuneralHomeManager({ homes, onUpdate }: Props) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");

  return (
    <section className="panel-section settings-panel">
      <p className="eyebrow">Directory</p>
      <h2>Learned funeral homes</h2>
      {homes.length === 0 && <p className="muted">Names will appear here after entries are saved.</p>}
      {homes.map((home) => (
        <div className="directory-row" key={home.id}>
          <input defaultValue={home.name} onBlur={(event) => { if (event.target.value.trim() !== home.name) void window.nightShift.renameFuneralHome(home.id, event.target.value).then(onUpdate); }} />
          <button onClick={() => void window.nightShift.deleteFuneralHome(home.id).then(onUpdate)}>Remove</button>
        </div>
      ))}
      {homes.length > 1 && (
        <div className="merge-box">
          <label>
            Merge
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">Choose…</option>
              {homes.map((home) => <option value={home.id} key={home.id}>{home.name}</option>)}
            </select>
          </label>
          <label>
            Into
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose…</option>
              {homes.filter((home) => home.id !== source).map((home) => <option value={home.id} key={home.id}>{home.name}</option>)}
            </select>
          </label>
          <button className="secondary" disabled={!source || !target} onClick={() => void window.nightShift.mergeFuneralHomes(source, target).then(onUpdate)}>Merge</button>
        </div>
      )}
    </section>
  );
}
