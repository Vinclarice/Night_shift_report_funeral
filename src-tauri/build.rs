fn main() {
    // Tauri's default Windows manifest plus the Windows 8+ declaration that lets src/snap.rs create its
    // see-through child window; the file says why.
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("the Tauri build script failed");
}
