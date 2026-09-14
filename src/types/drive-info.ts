export type DriveInfo = {
	name: string;
	path: string;
	mount_point: string;
	file_system: string;
	drive_type: string;
	total_space: number;
	available_space: number;
	used_space: number;
	percent_used: number;
	is_removable: boolean;
	is_read_only: boolean;
	is_mounted: boolean;
	/** Si hay que abrirla con una frase de paso antes de poder montarla. */
	is_encrypted: boolean;
	device_path: string;
};
