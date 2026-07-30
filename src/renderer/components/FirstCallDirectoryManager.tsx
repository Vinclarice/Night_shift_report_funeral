import { useMemo, useState } from "react";

import type { FirstCallDirectoryKind, FirstCallDirectories, FirstCallFacility, FirstCallFuneralHome } from "@/domain/firstCall";
import type { FirstCallFacilityInput, FirstCallFuneralHomeInput } from "@/shared/contracts";
import { IconSearch, IconTrash, IconX } from "../icons";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { ConfirmDialog } from "./ConfirmDialog";

type DirectoryItem = FirstCallFuneralHome | FirstCallFacility;

interface Props {
  directories: FirstCallDirectories;
  onClose: () => void;
  onSaveFuneralHome: (input: FirstCallFuneralHomeInput) => Promise<void>;
  onSaveFacility: (input: FirstCallFacilityInput) => Promise<void>;
  onDelete: (kind: FirstCallDirectoryKind, id: string) => Promise<void>;
  onMerge: (kind: FirstCallDirectoryKind, sourceId: string, targetId: string) => Promise<void>;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
}

function DirectoryEditor({ kind, item, items, onSaveFuneralHome, onSaveFacility, onDelete, onMerge }: {
  kind: FirstCallDirectoryKind;
  item: DirectoryItem;
  items: DirectoryItem[];
  onSaveFuneralHome: Props["onSaveFuneralHome"];
  onSaveFacility: Props["onSaveFacility"];
  onDelete: Props["onDelete"];
  onMerge: Props["onMerge"];
}) {
  const funeralHome = kind === "funeralHome" ? item as FirstCallFuneralHome : null;
  const [name, setName] = useState(item.name);
  const [address, setAddress] = useState(item.address);
  const [phone, setPhone] = useState(item.phone);
  const [fax, setFax] = useState(funeralHome?.fax ?? "");
  const [email, setEmail] = useState(funeralHome?.email ?? "");
  const [aliases, setAliases] = useState(item.aliases.join(", "));
  const [favorite, setFavorite] = useState(item.favorite);
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aliasList = aliases.split(",").map((alias) => alias.trim()).filter(Boolean);

  async function save() {
    if (kind === "funeralHome") await onSaveFuneralHome({ id: item.id, name, address, phone, fax, email, aliases: aliasList, favorite });
    else await onSaveFacility({ id: item.id, name, address, phone, aliases: aliasList, favorite });
  }

  return <div className="first-call-directory-editor">
    <div className="first-call-directory-editor-title">
      <div><strong>Edit saved record</strong><small>{item.useCount ? `Used ${item.useCount} ${item.useCount === 1 ? "time" : "times"}` : "Not used yet"}</small></div>
      <button type="button" className="first-call-favorite" aria-label={favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={favorite} onClick={() => setFavorite((current) => !current)}>{favorite ? "★" : "☆"}</button>
    </div>
    <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <label>Address<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    <label>Telephone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
    {kind === "funeralHome" && <div className="two-field">
      <label>Fax<input value={fax} onChange={(event) => setFax(event.target.value)} /></label>
      <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    </div>}
    <label>Aliases<input value={aliases} placeholder="Separate alternate names with commas" onChange={(event) => setAliases(event.target.value)} /></label>
    <div className="first-call-directory-actions">
      <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>Save changes</Button>
      <Button variant="quiet" icon={<IconTrash />} onClick={() => setConfirmDelete(true)}>Delete</Button>
    </div>
    {items.length > 1 && <div className="first-call-merge-controls">
      <label>Merge this record into<select aria-label="Merge target" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
        <option value="">Choose the record to keep</option>
        {items.filter((candidate) => candidate.id !== item.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select></label>
      <Button variant="secondary" disabled={!mergeTarget} onClick={() => void onMerge(kind, item.id, mergeTarget)}>Merge records</Button>
      <small>The kept record receives this name as an alias and retains the most complete contact details.</small>
    </div>}
    {confirmDelete && <ConfirmDialog title="Delete this saved record?" message={`${item.name} will be removed from the reusable First Call directory.`} confirmLabel="Delete record" danger onConfirm={() => { setConfirmDelete(false); void onDelete(kind, item.id); }} onCancel={() => setConfirmDelete(false)} />}
  </div>;
}

export function FirstCallDirectoryManager({ directories, onClose, onSaveFuneralHome, onSaveFacility, onDelete, onMerge, onExport, onImport }: Props) {
  const [kind, setKind] = useState<FirstCallDirectoryKind>("funeralHome");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items: DirectoryItem[] = kind === "funeralHome" ? directories.funeralHomes : directories.facilities;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => !normalized || [item.name, item.address, ...item.aliases].some((value) => value.toLowerCase().includes(normalized)));
  }, [items, query]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  function changeKind(next: FirstCallDirectoryKind) {
    setKind(next);
    setSelectedId(null);
    setQuery("");
  }

  return <div className="modal-backdrop first-call-directory-backdrop" role="presentation">
    <section className="modal first-call-directory-modal" role="dialog" aria-modal="true" aria-labelledby="first-call-directory-title">
      <header className="modal-header">
        <div><p className="studio-kicker">Reusable locations only</p><h2 id="first-call-directory-title">First Call directories</h2></div>
        <IconButton icon={<IconX />} aria-label="Close directory manager" onClick={onClose} />
      </header>
      <div className="first-call-directory-toolbar">
        <div className="first-call-kind" role="group" aria-label="Directory type">
          <button className={kind === "funeralHome" ? "active" : ""} onClick={() => changeKind("funeralHome")}>Funeral homes</button>
          <button className={kind === "facility" ? "active" : ""} onClick={() => changeKind("facility")}>Facilities</button>
        </div>
        <div className="first-call-directory-transfer"><Button variant="quiet" onClick={() => void onImport()}>Import CSV</Button><Button variant="quiet" onClick={() => void onExport()}>Export CSV</Button></div>
      </div>
      <div className="first-call-directory-body">
        <aside className="first-call-directory-list">
          <label className="first-call-directory-search"><IconSearch /><input aria-label="Search saved directory" value={query} placeholder="Search names, aliases, or addresses" onChange={(event) => setQuery(event.target.value)} /></label>
          <div>
            {filtered.map((item) => <button key={item.id} className={selected?.id === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}>
              <span><strong>{item.favorite && <b aria-label="Favorite">★</b>}{item.name}</strong><small>{item.address || "No address saved"}</small></span>
              {item.aliases.length > 0 && <em>{item.aliases.join(" · ")}</em>}
            </button>)}
            {!filtered.length && <p>No saved records match this search.</p>}
          </div>
        </aside>
        <main className="first-call-directory-detail">
          {selected ? <DirectoryEditor key={`${kind}-${selected.id}`} kind={kind} item={selected} items={items} onSaveFuneralHome={onSaveFuneralHome} onSaveFacility={onSaveFacility} onDelete={onDelete} onMerge={onMerge} /> : <div className="first-call-directory-empty"><strong>Select a saved record</strong><span>Edit contact details, aliases, favorites, duplicates, or remove it.</span></div>}
        </main>
      </div>
    </section>
  </div>;
}
