// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

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
