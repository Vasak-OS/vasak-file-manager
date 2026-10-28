/** Una entrada de la papelera, tal como la devuelve `list_trash`. */
export interface TrashEntry {
	name: string;
	original_path: string;
	/** Segundos unix en que se mandó a la papelera. */
	deleted_time: number;
}
