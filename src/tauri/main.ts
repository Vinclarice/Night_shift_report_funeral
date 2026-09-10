// Entry point for the Tauri build. The bridge has to be in place before the interface mounts, and
// modules evaluate in import order, so it comes first.
import "./bridge";
import "../renderer/src";
import "./print.css";
