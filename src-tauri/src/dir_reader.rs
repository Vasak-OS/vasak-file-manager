use crate::utils::normalize_path;
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
    pub device_path: String,
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
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with('.'))
            .unwrap_or(false)
}

fn get_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
}

fn get_mime_type(extension: &Option<String>) -> Option<String> {
    extension.as_ref().map(|ext| {
        match ext.as_str() {
            "txt" | "text" => "text/plain",
            "html" | "htm" => "text/html",
            "css" => "text/css",
            "js" | "mjs" => "text/javascript",
            "json" => "application/json",
            "xml" => "application/xml",
            "pdf" => "application/pdf",
            "zip" => "application/zip",
            "tar" => "application/x-tar",
            "gz" | "gzip" => "application/gzip",
            "rar" => "application/vnd.rar",
            "7z" => "application/x-7z-compressed",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "flac" => "audio/flac",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "avi" => "video/x-msvideo",
            "mkv" => "video/x-matroska",
            "mov" => "video/quicktime",
            "doc" => "application/msword",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls" => "application/vnd.ms-excel",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "ppt" => "application/vnd.ms-powerpoint",
            "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "rs" => "text/x-rust",
            "ts" | "tsx" => "text/typescript",
            "vue" => "text/x-vue",
            "py" => "text/x-python",
            "rb" => "text/x-ruby",
            "go" => "text/x-go",
            "java" => "text/x-java",
            "c" | "h" => "text/x-c",
            "cpp" | "hpp" | "cc" => "text/x-c++",
            "md" | "markdown" => "text/markdown",
            "yaml" | "yml" => "text/yaml",
            "toml" => "text/x-toml",
            "exe" => "application/x-msdownload",
            "dll" => "application/x-msdownload",
            "so" => "application/x-sharedlib",
            _ => "application/octet-stream",
        }
        .to_string()
    })
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

    let mime = if is_file {
        get_mime_type(&extension)
    } else {
        None
    };

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

    let mut entries: Vec<DirEntry> = Vec::new();
    let mut dir_count = 0;
    let mut file_count = 0;

    for entry_result in read_result {
        if let Ok(entry) = entry_result {
            if let Some(dir_entry) = read_entry(&entry.path()) {
                if dir_entry.is_dir {
                    dir_count += 1;
                } else if dir_entry.is_file {
                    file_count += 1;
                }
                entries.push(dir_entry);
            }
        }
    }

    entries.sort_by(|first, second| match (first.is_dir, second.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => first.name.to_lowercase().cmp(&second.name.to_lowercase()),
    });

    Ok(DirContents {
        path: normalize_path(&path),
        entries,
        total_count: dir_count + file_count,
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

            let label = get_device_label(&dev_path).unwrap_or_else(|| partition_name.to_uppercase());
            let file_system = fs_type.unwrap_or_default();

            drives.push(DriveInfo {
                name: label,
                path: normalize_path(&dev_path),
                mount_point: String::new(),
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

        let display_name = {

                mount_point_last_component(&mount_point)

        };

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
  return Ok(linux_get_mountable_devices());
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

#[tauri::command]
pub fn mount_drive(device_path: String) -> Result<String, String> {

        if let Ok(output) = std::process::Command::new("udisksctl")
            .args(["mount", "-b", &device_path, "--no-user-interaction"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let mount_point = stdout
                    .split(" at ")
                    .nth(1)
                    .map(|segment| segment.trim().trim_end_matches('.').to_string())
                    .unwrap_or_default();
                return Ok(mount_point);
            }
        }

        if let Ok(output) = std::process::Command::new("gio")
            .args(["mount", "-d", &device_path])
            .output()
        {
            if output.status.success() {
                return Ok(String::new());
            }
        }

        Err(format!(
            "Could not mount {}. Install udisks2 for automatic mounting.",
            device_path
        ))

}

#[tauri::command]
pub fn unmount_drive(device_path: String, mount_point: String) -> Result<(), String> {

        return linux_unmount(&device_path, &mount_point);

}

fn linux_unmount(device_path: &str, mount_point: &str) -> Result<(), String> {
    if device_path.starts_with("/dev/") {
        if let Ok(output) = std::process::Command::new("udisksctl")
            .args(["unmount", "-b", device_path, "--no-user-interaction"])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
        }
    }

    if !mount_point.is_empty() {
        if let Ok(output) = std::process::Command::new("fusermount")
            .args(["-u", mount_point])
            .output()
        {
            if output.status.success() {
                return Ok(());
            }
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

// ---------------------------------------------------------------------------
// Network share mounting
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn mount_network_share(params: NetworkShareParams) -> Result<String, String> {

        let mount_base = {
          "/mnt"
        };

        let mount_point = format!("{}/{}", mount_base, params.mount_name);

        fs::create_dir_all(&mount_point)
            .map_err(|dir_error| format!("Failed to create mount point: {}", dir_error))?;

        let result = match params.protocol.as_str() {
            "sshfs" => mount_sshfs(&params, &mount_point),
            "nfs" => mount_nfs(&params, &mount_point),
            "smb" => mount_smb(&params, &mount_point),
            unknown => Err(format!("Unknown protocol: {}", unknown)),
        };

        if result.is_err() {
            let _ = fs::remove_dir(&mount_point);
        }

        result.map(|_| mount_point)
}


fn mount_sshfs(params: &NetworkShareParams, mount_point: &str) -> Result<(), String> {
    let username = params.username.as_deref().unwrap_or("root");
    let port = params.port.unwrap_or(22);
    let source = format!("{}@{}:{}", username, params.host, params.remote_path);

    let mut command = std::process::Command::new("sshfs");
    command.args([
        &source,
        mount_point,
        "-p",
        &port.to_string(),
        "-o",
        "StrictHostKeyChecking=no",
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
            .map_err(|spawn_error| {
                format!("Failed to run sshfs: {}. Is sshfs installed?", spawn_error)
            })?;

        if let Some(ref mut stdin) = child.stdin {
            let _ = stdin.write_all(password.as_bytes());
        }

        child
            .wait_with_output()
            .map_err(|wait_error| format!("sshfs process error: {}", wait_error))?
    } else {
        command.output().map_err(|run_error| {
            format!("Failed to run sshfs: {}. Is sshfs installed?", run_error)
        })?
    };

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("sshfs failed: {}", stderr.trim()))
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

fn mount_smb(params: &NetworkShareParams, mount_point: &str) -> Result<(), String> {
    let source = format!("//{}/{}", params.host, params.remote_path);


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

        let mut mount_args = vec!["-t", "cifs", &source, mount_point];
        let options = if let Some(ref username) = params.username {
            if let Some(ref password) = params.password {
                format!("username={},password={}", username, password)
            } else {
                format!("username={}", username)
            }
        } else {
            "guest".to_string()
        };
        mount_args.extend(["-o", &options]);

        let output = std::process::Command::new("mount")
            .args(&mount_args)
            .output()
            .map_err(|run_error| format!("Failed to run mount: {}", run_error))?;

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
        .and_then(|parent| parent.to_str())
        .map(|path_str| normalize_path(path_str))
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}