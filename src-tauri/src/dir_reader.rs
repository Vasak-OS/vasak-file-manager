use crate::utils::normalize_path;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use sysinfo::Disks;

#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub ext: Option<String>,
    pub path: String,
    pub size: u64,
    pub item_count: Option<u32>,
    pub modified_time: u64,
    pub accessed_time: u64,
    pub created_time: u64,
    pub mime: Option<String>,
    pub is_file: bool,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirContents {
    pub path: String,
    pub entries: Vec<DirEntry>,
    pub total_count: usize,
    pub dir_count: usize,
    pub file_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
    pub mount_point: String,
    pub file_system: String,
    pub drive_type: String,
    pub total_space: u64,
    pub available_space: u64,
    pub used_space: u64,
    pub percent_used: f64,
    pub is_removable: bool,
    pub is_read_only: bool,
    pub is_mounted: bool,
    /// Si hay que abrirla con una frase de paso antes de poder montarla.
    ///
    /// La ventana lo usa para dos cosas: mostrar el candado, y saber que un clic
    /// acá va a abrir un diálogo en vez de montar y listo.
    pub is_encrypted: bool,
    pub device_path: String,
}

/// Lo que `lsblk` y `udisks2` llaman a una partición LUKS.
pub const SISTEMA_DE_ARCHIVOS_CIFRADO: &str = "crypto_LUKS";

/// Si ese sistema de archivos es en realidad un volumen cifrado sin abrir.
pub fn es_cifrado(file_system: &str) -> bool {
    file_system.eq_ignore_ascii_case(SISTEMA_DE_ARCHIVOS_CIFRADO)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MountableDevice {
    pub name: String,
    pub device_path: String,
    pub file_system: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkShareParams {
    pub protocol: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub remote_path: String,
    pub mount_name: String,
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(std::ffi::OsStr::to_str)
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn get_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_lowercase)
}

fn read_entry(path: &Path) -> Option<DirEntry> {
    let metadata = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(_) => return None,
    };

    let symlink_metadata = fs::symlink_metadata(path).ok();
    let is_symlink = symlink_metadata
        .map(|meta| meta.is_symlink())
        .unwrap_or(false);

    let name = path.file_name()?.to_str()?.to_string();
    let extension = get_extension(path);
    let path_string = normalize_path(path.to_str()?);
    let is_dir = metadata.is_dir();
    let is_file = metadata.is_file();

    let modified_time = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let accessed_time = metadata
        .accessed()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let created_time = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let size = if is_file { metadata.len() } else { 0 };

    let item_count = if is_dir {
        fs::read_dir(path)
            .ok()
            .map(|entries| entries.count() as u32)
    } else {
        None
    };

    // Sólo lo que sale del nombre, que no toca el disco. Mirar adentro cuesta
    // 150 µs por archivo y no se puede repartir entre los núcleos, así que eso lo
    // pide la ventana y sólo para lo que llega a dibujar. Ver `tipo_de_contenido`.
    let mime = crate::tipo_de_contenido::por_el_nombre(path, is_file);

    Some(DirEntry {
        name,
        ext: extension,
        path: path_string,
        size,
        item_count,
        modified_time,
        accessed_time,
        created_time,
        mime,
        is_file,
        is_dir,
        is_symlink,
        is_hidden: is_hidden(path),
    })
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<DirContents, String> {
    let directory = Path::new(&path);

    if !directory.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !directory.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let read_result = fs::read_dir(directory).map_err(|error| error.to_string())?;

    // Leer las entradas en paralelo.
    //
    // Cada una hace lo suyo sin mirar a las demás —dos `stat`, contar lo que hay
    // adentro si es carpeta, y adivinar el tipo de contenido—, así que el lazo
    // secuencial que había sólo servía para sumar esperas de disco. El orden que
    // se pierda no importa: abajo se ordena igual.
    let rutas: Vec<std::path::PathBuf> = read_result.flatten().map(|entry| entry.path()).collect();

    let mut entries: Vec<DirEntry> = rutas
        .par_iter()
        .filter_map(|ruta| read_entry(ruta))
        .collect();

    let dir_count = entries.iter().filter(|entrada| entrada.is_dir).count();
    let file_count = entries.iter().filter(|entrada| entrada.is_file).count();
    // El total sale de la lista y no de sumar los dos contadores: una tubería con
    // nombre, un zócalo o un dispositivo no son ni carpeta ni archivo regular,
    // así que no entran en ninguno de los dos y el total decía menos de las
    // entradas que se devolvían.
    let total_count = entries.len();

    entries.sort_by(|first, second| match (first.is_dir, second.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => first.name.to_lowercase().cmp(&second.name.to_lowercase()),
    });

    Ok(DirContents {
        path: normalize_path(&path),
        entries,
        total_count,
        dir_count,
        file_count,
    })
}

fn is_virtual_filesystem(file_system: &str) -> bool {
    let fs_lower = file_system.to_lowercase();
    let virtual_fs: [&str; 24] = [
        "tmpfs",
        "cgroup",
        "cgroup2",
        "sysfs",
        "proc",
        "devtmpfs",
        "securityfs",
        "debugfs",
        "configfs",
        "fusectl",
        "mqueue",
        "hugetlbfs",
        "devpts",
        "bpf",
        "tracefs",
        "pstore",
        "efivarfs",
        "squashfs",
        "overlay",
        "fuse.portal",
        "portal",
        "autofs",
        "ramfs",
        "rpc_pipefs",
    ];
    virtual_fs.iter().any(|virtual_fs_type| {
        fs_lower.starts_with(virtual_fs_type) || fs_lower.contains(virtual_fs_type)
    })
}

fn is_network_filesystem(file_system: &str) -> bool {
    let fs_lower = file_system.to_lowercase();
    let network_fs: [&str; 7] = [
        "nfs",
        "nfs4",
        "cifs",
        "smbfs",
        "fuse.sshfs",
        "fuse.rclone",
        "fuse.gvfsd-fuse",
    ];
    network_fs
        .iter()
        .any(|network_fs_type| fs_lower == *network_fs_type)
}

fn should_skip_linux_mount(file_system: &str, name: &str, mount_point: &str) -> bool {
    if is_virtual_filesystem(file_system) {
        return true;
    }
    if name.to_lowercase() == "none" {
        return true;
    }
    if mount_point.starts_with("/dev/") && !mount_point.starts_with("/dev/pts") {
        return true;
    }
    if mount_point == "/" {
        return true;
    }
    let is_user_mount = mount_point.starts_with("/media/")
        || mount_point.starts_with("/mnt/")
        || mount_point.starts_with("/run/media/");
    if is_user_mount || is_network_filesystem(file_system) {
        return false;
    }
    true
}

// ---------------------------------------------------------------------------
// Display name helpers (per-platform)
// ---------------------------------------------------------------------------

fn mount_point_last_component(mount_point: &str) -> String {
    mount_point
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or(mount_point)
        .to_string()
}

fn get_mounted_device_paths() -> std::collections::HashSet<String> {
    fs::read_to_string("/proc/mounts")
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let device = line.split_whitespace().next()?;
            let canonical = fs::canonicalize(device)
                .unwrap_or_else(|_| std::path::PathBuf::from(device))
                .to_string_lossy()
                .to_string();
            Some([device.to_string(), canonical])
        })
        .flatten()
        .collect()
}

fn linux_get_unmounted_drive_infos(
    seen_device_paths: &mut std::collections::HashSet<String>,
) -> Vec<DriveInfo> {
    let mounted_devices = get_mounted_device_paths();
    let sys_block = Path::new("/sys/block");
    let mut drives: Vec<DriveInfo> = Vec::new();

    let block_entries = match fs::read_dir(sys_block) {
        Ok(entries) => entries,
        Err(_) => return drives,
    };

    for block_entry in block_entries.flatten() {
        let block_name = block_entry.file_name().to_string_lossy().to_string();

        if block_name.starts_with("loop")
            || block_name.starts_with("ram")
            || block_name.starts_with("dm-")
            || block_name.starts_with("zram")
        {
            continue;
        }

        let block_path = block_entry.path();
        let removable_flag = fs::read_to_string(block_path.join("removable"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let is_removable = removable_flag == "1"
            || fs::canonicalize(&block_path)
                .map(|resolved| resolved.to_string_lossy().contains("/usb"))
                .unwrap_or(false);

        let is_read_only = fs::read_to_string(block_path.join("ro"))
            .unwrap_or_default()
            .trim()
            == "1";

        let rotational = fs::read_to_string(block_path.join("queue").join("rotational"))
            .unwrap_or_default()
            .trim()
            .to_string();

        let drive_type = match rotational.as_str() {
            "0" => "SSD".to_string(),
            "1" => "HDD".to_string(),
            _ => "Unknown".to_string(),
        };

        let mut partitions: Vec<String> = Vec::new();
        if let Ok(sub_entries) = fs::read_dir(&block_path) {
            for sub_entry in sub_entries.flatten() {
                let sub_name = sub_entry.file_name().to_string_lossy().to_string();
                if sub_name.starts_with(&block_name) && sub_entry.path().join("partition").exists()
                {
                    partitions.push(sub_name);
                }
            }
        }

        if partitions.is_empty() {
            partitions.push(block_name.clone());
        }

        for partition_name in &partitions {
            let dev_path = format!("/dev/{}", partition_name);
            if !Path::new(&dev_path).exists() {
                continue;
            }

            let canonical = fs::canonicalize(&dev_path)
                .unwrap_or_else(|_| std::path::PathBuf::from(&dev_path))
                .to_string_lossy()
                .to_string();

            if mounted_devices.contains(&dev_path) || mounted_devices.contains(&canonical) {
                continue;
            }

            if seen_device_paths.contains(&dev_path) || seen_device_paths.contains(&canonical) {
                continue;
            }

            let fs_type = get_partition_fs_type(partition_name);
            if fs_type.is_none() {
                continue;
            }

            let size_sectors: u64 = fs::read_to_string(
                sys_block
                    .join(&block_name)
                    .join(partition_name)
                    .join("size"),
            )
            .or_else(|_| fs::read_to_string(sys_block.join(&block_name).join("size")))
            .unwrap_or_default()
            .trim()
            .parse()
            .unwrap_or(0);

            let total_space = size_sectors.saturating_mul(512);
            if total_space == 0 {
                continue;
            }

            let label =
                get_device_label(&dev_path).unwrap_or_else(|| partition_name.to_uppercase());
            let file_system = fs_type.unwrap_or_default();

            drives.push(DriveInfo {
                name: label,
                path: normalize_path(&dev_path),
                mount_point: String::new(),
                is_encrypted: es_cifrado(&file_system),
                file_system,
                drive_type: drive_type.clone(),
                total_space,
                available_space: 0,
                used_space: 0,
                percent_used: 0.0,
                is_removable,
                is_read_only,
                is_mounted: false,
                device_path: dev_path.clone(),
            });

            seen_device_paths.insert(dev_path);
            seen_device_paths.insert(canonical);
        }
    }

    drives
}

// ---------------------------------------------------------------------------
// Main drive listing command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_system_drives() -> Result<Vec<DriveInfo>, String> {
    let disks = Disks::new_with_refreshed_list();
    let mut drives: Vec<DriveInfo> = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut seen_device_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for disk in disks.iter() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let path = normalize_path(&mount_point);

        let total_space = disk.total_space();
        let available_space = disk.available_space();

        if total_space == 0
            || should_skip_linux_mount(
                &disk.file_system().to_string_lossy(),
                &disk.name().to_string_lossy(),
                &mount_point,
            )
        {
            continue;
        }

        if !seen_paths.insert(path.clone()) {
            continue;
        }

        let used_space = total_space.saturating_sub(available_space);
        let percent_used = if total_space > 0 {
            ((used_space as f64 / total_space as f64) * 100.0).round()
        } else {
            0.0
        };

        let file_system_str = disk.file_system().to_string_lossy().to_lowercase();
        let is_network_fs = matches!(
            file_system_str.as_str(),
            "nfs"
                | "nfs4"
                | "cifs"
                | "smbfs"
                | "fuse.sshfs"
                | "fuse.rclone"
                | "fuse.gvfsd-fuse"
                | "afpfs"
        );

        let drive_type = if is_network_fs {
            "Network".to_string()
        } else {
            match disk.kind() {
                sysinfo::DiskKind::HDD => "HDD".to_string(),
                sysinfo::DiskKind::SSD => "SSD".to_string(),
                sysinfo::DiskKind::Unknown(_) => "Unknown".to_string(),
            }
        };

        let display_name = { mount_point_last_component(&mount_point) };

        let device_path = disk.name().to_string_lossy().to_string();
        let canonical_device_path = fs::canonicalize(&device_path)
            .unwrap_or_else(|_| std::path::PathBuf::from(&device_path))
            .to_string_lossy()
            .to_string();

        seen_device_paths.insert(device_path.clone());
        seen_device_paths.insert(canonical_device_path);

        drives.push(DriveInfo {
            name: display_name,
            path,
            mount_point,
            file_system: disk.file_system().to_string_lossy().to_string(),
            drive_type,
            total_space,
            available_space,
            used_space,
            percent_used,
            is_removable: disk.is_removable(),
            is_read_only: disk.is_read_only(),
            is_mounted: true,
            // Una unidad montada ya está abierta: lo que se ve es el volumen en
            // claro, no el cifrado que hay debajo.
            is_encrypted: false,
            device_path,
        });
    }

    drives.extend(linux_get_unmounted_drive_infos(&mut seen_device_paths));

    drives.sort_by(|first, second| first.path.cmp(&second.path));

    Ok(drives)
}

fn get_device_label(device_path: &str) -> Option<String> {
    let label_dir = Path::new("/dev/disk/by-label");
    if !label_dir.exists() {
        return None;
    }
    let canonical_device = fs::canonicalize(device_path).ok()?;
    for entry in fs::read_dir(label_dir).ok()?.flatten() {
        if let Ok(target) = fs::canonicalize(entry.path()) {
            if target == canonical_device {
                let label = entry.file_name().to_string_lossy().to_string();
                return Some(label.replace("\\x20", " "));
            }
        }
    }
    None
}

fn get_partition_fs_type(device_name: &str) -> Option<String> {
    let output = std::process::Command::new("lsblk")
        .args(["-no", "FSTYPE", &format!("/dev/{}", device_name)])
        .output()
        .ok()?;
    let fs_type = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if fs_type.is_empty() {
        None
    } else {
        Some(fs_type)
    }
}

// ---------------------------------------------------------------------------
// Mountable device discovery
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_mountable_devices() -> Result<Vec<MountableDevice>, String> {
    Ok(linux_get_mountable_devices())
}

fn linux_get_mountable_devices() -> Vec<MountableDevice> {
    let mounted_devices: std::collections::HashSet<String> = fs::read_to_string("/proc/mounts")
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let device = line.split_whitespace().next()?;
            fs::canonicalize(device)
                .ok()
                .map(|resolved| resolved.to_string_lossy().to_string())
        })
        .collect();

    let mut devices: Vec<MountableDevice> = Vec::new();
    let sys_block = Path::new("/sys/block");

    let block_entries = match fs::read_dir(sys_block) {
        Ok(entries) => entries,
        Err(_) => return devices,
    };

    for block_entry in block_entries.flatten() {
        let block_name = block_entry.file_name().to_string_lossy().to_string();

        if block_name.starts_with("loop")
            || block_name.starts_with("ram")
            || block_name.starts_with("dm-")
            || block_name.starts_with("zram")
        {
            continue;
        }

        let removable_flag = fs::read_to_string(block_entry.path().join("removable"))
            .unwrap_or_default()
            .trim()
            .to_string();

        let is_usb_transport = fs::canonicalize(block_entry.path())
            .map(|resolved| resolved.to_string_lossy().contains("/usb"))
            .unwrap_or(false);

        if removable_flag != "1" && !is_usb_transport {
            continue;
        }

        let mut partitions: Vec<String> = Vec::new();
        if let Ok(sub_entries) = fs::read_dir(block_entry.path()) {
            for sub_entry in sub_entries.flatten() {
                let sub_name = sub_entry.file_name().to_string_lossy().to_string();
                if sub_name.starts_with(&block_name) && sub_entry.path().join("partition").exists()
                {
                    partitions.push(sub_name);
                }
            }
        }

        if partitions.is_empty() {
            partitions.push(block_name.clone());
        }

        for partition_name in &partitions {
            let dev_path = format!("/dev/{}", partition_name);
            let canonical = fs::canonicalize(&dev_path)
                .unwrap_or_else(|_| std::path::PathBuf::from(&dev_path))
                .to_string_lossy()
                .to_string();

            if mounted_devices.contains(&dev_path) || mounted_devices.contains(&canonical) {
                continue;
            }

            if !Path::new(&dev_path).exists() {
                continue;
            }

            let fs_type = get_partition_fs_type(partition_name);
            if fs_type.is_none() {
                continue;
            }

            let size_sectors: u64 = fs::read_to_string(
                sys_block
                    .join(&block_name)
                    .join(partition_name)
                    .join("size"),
            )
            .or_else(|_| fs::read_to_string(sys_block.join(&block_name).join("size")))
            .unwrap_or_default()
            .trim()
            .parse()
            .unwrap_or(0);

            let label =
                get_device_label(&dev_path).unwrap_or_else(|| partition_name.to_uppercase());

            devices.push(MountableDevice {
                name: label,
                device_path: dev_path,
                file_system: fs_type.unwrap_or_default(),
                size: size_sectors * 512,
            });
        }
    }

    devices
}

// ---------------------------------------------------------------------------
// Mount / unmount commands
// ---------------------------------------------------------------------------

/// Monta una unidad, pidiendo lo que haga falta.
///
/// El trabajo está en `montaje`: acá sólo queda el comando. Lo que cambió es que
/// ahora el error llega entero hasta la ventana en vez de perderse, y que una
/// partición cifrada se puede abrir. Ver ese módulo.
#[tauri::command]
pub async fn mount_drive(device_path: String) -> Result<String, crate::montaje::FalloDeMontaje> {
    crate::montaje::montar(&device_path).await
}

/// Desmonta la unidad, y cierra lo que hubiera que cerrar.
///
/// Lo segundo es la otra mitad de poder abrir discos cifrados: desmontar deja el
/// volumen en claro abierto en `/dev/mapper`, y quien expulsó un disco cifrado
/// espera justamente lo contrario. Ver `montaje::cerrar_volumen_cifrado`.
#[tauri::command]
pub async fn unmount_drive(device_path: String, mount_point: String) -> Result<(), String> {
    linux_unmount(&device_path, &mount_point)?;
    crate::montaje::cerrar_volumen_cifrado(&device_path).await;
    Ok(())
}

fn linux_unmount(device_path: &str, mount_point: &str) -> Result<(), String> {
    if device_path.starts_with("/dev/") {
        if let Ok(output) = std::process::Command::new("udisksctl")
            .args(["unmount", "-b", device_path])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }
    }

    if !mount_point.is_empty() {
        if unmount_fuse(mount_point, |program, args| {
            std::process::Command::new(program).args(args).output()
        }) {
            return Ok(());
        }

        if let Ok(output) = std::process::Command::new("umount")
            .arg(mount_point)
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(stderr.trim().to_string());
        }
    }

    Err(format!(
        "Could not unmount. Install udisks2 or use 'umount {}'.",
        mount_point
    ))
}

/// Los programas con los que se desmonta lo que montó `sshfs`, en orden.
///
/// `sshfs` 3 depende de FUSE 3, y en FUSE 3 el programa se llama `fusermount3`.
/// En Arch `fuse3` no trae `fusermount` —ése es de `fuse2`—, así que llamar sólo
/// a `fusermount` dejaba sin desmontar una carpeta montada por SSH y caía a
/// `umount`, que sin ser root no puede. En Debian trixie `fuse3` instala los
/// dos, el viejo como enlace al nuevo. `fusermount` queda de respaldo para un
/// sistema que sólo tenga FUSE 2.
const FUSE_UNMOUNTERS: [&str; 2] = ["fusermount3", "fusermount"];

/// Desmonta `mount_point` con el primer programa de `FUSE_UNMOUNTERS` que
/// funcione. `run` lanza el programa; es un parámetro para poder probar el orden
/// sin FUSE instalado.
fn unmount_fuse<F>(mount_point: &str, mut run: F) -> bool
where
    F: FnMut(&str, &[&str]) -> std::io::Result<std::process::Output>,
{
    FUSE_UNMOUNTERS.iter().any(|program| {
        run(program, &["-u", mount_point]).is_ok_and(|output| output.status.success())
    })
}

// ---------------------------------------------------------------------------
// Network share mounting
// ---------------------------------------------------------------------------

/// Por qué no se pudo montar una carpeta de red, en términos que la ventana
/// pueda traducir. Mismo criterio que `montaje::FalloDeMontaje`: el código y no
/// el texto, porque el backend no sabe en qué idioma está la ventana.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NetworkMountError {
    pub code: String,
    pub detail: String,
}

/// Falta el programa con el que se monta. El detalle es el **paquete** que hay
/// que instalar, que es lo que la persona puede hacer al respecto.
pub const MISSING_PACKAGE: &str = "missingPackage";
/// Cualquier otro fallo; el detalle es lo que dijo el programa.
pub const NETWORK_MOUNT_FAILED: &str = "failed";

impl NetworkMountError {
    fn missing_package(package: &str) -> Self {
        Self {
            code: MISSING_PACKAGE.to_string(),
            detail: package.to_string(),
        }
    }

    fn failed(detail: impl Into<String>) -> Self {
        Self {
            code: NETWORK_MOUNT_FAILED.to_string(),
            detail: detail.into(),
        }
    }
}

/// El error de no haber podido lanzar `sshfs`.
///
/// Que no esté instalado es el caso que importa: `sshfs` es opcional en las dos
/// recetas (`recommends` en el `.deb`, `optdepends` en Arch), así que falta en
/// cualquier sistema donde nadie lo pidió, y la persona sí pidió montar. Antes
/// eso volvía como «Failed to run sshfs: No such file or directory (os error
/// 2). Is sshfs installed?», en inglés y sin decir qué instalar.
fn sshfs_spawn_error(error: &std::io::Error) -> NetworkMountError {
    if error.kind() == std::io::ErrorKind::NotFound {
        NetworkMountError::missing_package("sshfs")
    } else {
        NetworkMountError::failed(format!("sshfs: {error}"))
    }
}

#[tauri::command]
pub fn mount_network_share(params: NetworkShareParams) -> Result<String, NetworkMountError> {
    let mount_base = { "/mnt" };

    let mount_point = format!("{}/{}", mount_base, params.mount_name);

    fs::create_dir_all(&mount_point).map_err(|dir_error| {
        NetworkMountError::failed(format!("Failed to create mount point: {}", dir_error))
    })?;

    let result = match params.protocol.as_str() {
        "sshfs" => mount_sshfs(&params, &mount_point),
        "nfs" => mount_nfs(&params, &mount_point).map_err(NetworkMountError::failed),
        "smb" => mount_smb(&params, &mount_point).map_err(NetworkMountError::failed),
        unknown => Err(NetworkMountError::failed(format!(
            "Unknown protocol: {}",
            unknown
        ))),
    };

    if result.is_err() {
        let _ = fs::remove_dir(&mount_point);
    }

    result.map(|_| mount_point)
}

fn mount_sshfs(params: &NetworkShareParams, mount_point: &str) -> Result<(), NetworkMountError> {
    let username = params.username.as_deref().unwrap_or("root");
    let port = params.port.unwrap_or(22);
    let source = format!("{}@{}:{}", username, params.host, params.remote_path);

    let mut command = std::process::Command::new("sshfs");
    command.args([
        &source,
        mount_point,
        "-p",
        &port.to_string(),
        // accept-new: trust a host's key on first use, but reject it if a known
        // host's key changes (the MITM case). Non-interactive-safe (no TTY).
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "reconnect",
        "-o",
        "ServerAliveInterval=15",
    ]);

    if params.password.is_some() {
        command.args(["-o", "password_stdin"]);
    }

    let output = if let Some(ref password) = params.password {
        use std::io::Write;
        let mut child = command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|spawn_error| sshfs_spawn_error(&spawn_error))?;

        if let Some(ref mut stdin) = child.stdin {
            let _ = stdin.write_all(password.as_bytes());
        }

        child.wait_with_output().map_err(|wait_error| {
            NetworkMountError::failed(format!("sshfs process error: {}", wait_error))
        })?
    } else {
        command
            .output()
            .map_err(|run_error| sshfs_spawn_error(&run_error))?
    };

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(NetworkMountError::failed(format!(
            "sshfs failed: {}",
            stderr.trim()
        )))
    }
}

fn mount_nfs(params: &NetworkShareParams, mount_point: &str) -> Result<(), String> {
    let source = format!("{}:{}", params.host, params.remote_path);

    let output = std::process::Command::new("mount")
        .args(["-t", "nfs4", &source, mount_point])
        .output()
        .or_else(|_| {
            std::process::Command::new("mount")
                .args(["-t", "nfs", &source, mount_point])
                .output()
        })
        .map_err(|run_error| format!("Failed to run mount: {}", run_error))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("NFS mount failed: {}", stderr.trim()))
    }
}

/// Write SMB credentials to a private (0600) file for `mount.cifs` to read via
/// its `credentials=` option, so the password never appears on the command line
/// (`/proc/<pid>/cmdline` is world-readable). Created with O_EXCL to avoid
/// symlink/pre-existing-file attacks; the caller deletes it after mounting.
fn write_smb_credentials(username: &str, password: &str) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    // Prefer the per-user runtime dir (0700); fall back to the temp dir.
    let base = std::env::var("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = base.join(format!("vasak-smb-{}-{}.cred", std::process::id(), nanos));

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|e| format!("Failed to create credentials file: {}", e))?;
    file.write_all(format!("username={}\npassword={}\n", username, password).as_bytes())
        .map_err(|e| format!("Failed to write credentials file: {}", e))?;
    Ok(path)
}

fn mount_smb(params: &NetworkShareParams, mount_point: &str) -> Result<(), String> {
    let source = format!("//{}/{}", params.host, params.remote_path);

    // Prefer userspace gio mount (no root; integrates with the keyring).
    let gio_uri = if let Some(ref username) = params.username {
        format!("smb://{}@{}/{}", username, params.host, params.remote_path)
    } else {
        format!("smb://{}/{}", params.host, params.remote_path)
    };

    if let Ok(output) = std::process::Command::new("gio")
        .args(["mount", &gio_uri])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    // Fallback: mount.cifs. Never put the password on the command line — write a
    // 0600 credentials file that mount.cifs reads, then delete it.
    let mut cred_file: Option<std::path::PathBuf> = None;
    let options = match (&params.username, &params.password) {
        (Some(username), Some(password)) => {
            let path = write_smb_credentials(username, password)?;
            let opt = format!("credentials={}", path.display());
            cred_file = Some(path);
            opt
        }
        (Some(username), None) => format!("username={}", username),
        _ => "guest".to_string(),
    };

    let output = std::process::Command::new("mount")
        .args(["-t", "cifs", &source, mount_point, "-o", &options])
        .output();

    // mount.cifs reads the file synchronously, so it is safe to remove now.
    if let Some(path) = cred_file {
        let _ = fs::remove_file(&path);
    }

    let output = output.map_err(|run_error| format!("Failed to run mount: {}", run_error))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("SMB mount failed: {}", stderr.trim()))
    }
}

// ---------------------------------------------------------------------------
// Other path utilities
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_parent_dir(path: String) -> Option<String> {
    Path::new(&path)
        .parent()
        .and_then(Path::to_str)
        .map(normalize_path)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};
    use std::os::unix::process::ExitStatusExt;
    use std::process::{ExitStatus, Output};

    fn exited(code: i32) -> std::io::Result<Output> {
        Ok(Output {
            // `from_raw` recibe el estado de `wait`: el código de salida va en
            // el segundo byte.
            status: ExitStatus::from_raw(code << 8),
            stdout: Vec::new(),
            stderr: Vec::new(),
        })
    }

    #[test]
    fn desmontar_prueba_fusermount3_primero() {
        let mut calls = Vec::new();
        let unmounted = unmount_fuse("/mnt/ssh", |program, args| {
            calls.push((program.to_string(), args.join(" ")));
            exited(0)
        });
        assert!(unmounted);
        // Si `fusermount3` desmontó, `fusermount` no se llega a lanzar.
        assert_eq!(
            calls,
            vec![("fusermount3".to_string(), "-u /mnt/ssh".to_string())]
        );
    }

    #[test]
    fn sin_fusermount3_cae_a_fusermount() {
        // Un sistema con sólo FUSE 2: `fusermount3` no existe.
        let mut calls = Vec::new();
        let unmounted = unmount_fuse("/mnt/ssh", |program, _| {
            calls.push(program.to_string());
            if program == "fusermount3" {
                Err(Error::from(ErrorKind::NotFound))
            } else {
                exited(0)
            }
        });
        assert!(unmounted);
        assert_eq!(calls, vec!["fusermount3", "fusermount"]);
    }

    #[test]
    fn si_fusermount3_falla_tambien_se_prueba_fusermount() {
        let mut calls = Vec::new();
        let unmounted = unmount_fuse("/mnt/ssh", |program, _| {
            calls.push(program.to_string());
            exited(if program == "fusermount3" { 1 } else { 0 })
        });
        assert!(unmounted);
        assert_eq!(calls, vec!["fusermount3", "fusermount"]);
    }

    #[test]
    fn sin_ningun_fusermount_no_se_da_por_desmontado() {
        // Y ahí `linux_unmount` sigue con `umount`.
        let unmounted = unmount_fuse("/mnt/ssh", |_, _| Err(Error::from(ErrorKind::NotFound)));
        assert!(!unmounted);
    }

    #[test]
    fn sin_sshfs_se_dice_que_paquete_falta() {
        let error = sshfs_spawn_error(&Error::from(ErrorKind::NotFound));
        assert_eq!(
            error,
            NetworkMountError {
                code: MISSING_PACKAGE.to_string(),
                detail: "sshfs".to_string(),
            }
        );
    }

    #[test]
    fn otro_fallo_al_lanzar_sshfs_no_se_confunde_con_que_falte() {
        let error = sshfs_spawn_error(&Error::from(ErrorKind::PermissionDenied));
        assert_eq!(error.code, NETWORK_MOUNT_FAILED);
        assert!(error.detail.starts_with("sshfs: "), "{}", error.detail);
    }

    #[test]
    fn el_error_de_montaje_de_red_viaja_con_codigo_y_detalle() {
        // La ventana lo lee por estos dos nombres (`network-mount-error.ts`).
        let json = serde_json::to_value(NetworkMountError::missing_package("sshfs")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "missingPackage", "detail": "sshfs" })
        );
    }
}
