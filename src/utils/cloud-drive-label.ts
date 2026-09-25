import type { CloudDrive } from '@/composables/use-cloud-drives';
import { interpolar } from '@/tools/interpolar';

/**
 * El nombre que oye un lector de pantalla, y lo que dice el tooltip, de un
 * disco en la nube.
 *
 * Una cuenta que no se puede abrir lleva el motivo pegado al nombre, en vez de
 * desaparecer de la lista: una que desaparece parece una cuenta que se borró.
 * Y hay dos motivos que se dicen distinto, porque piden cosas distintas de la
 * persona: reconectarla la arregla; «todavía no disponible» no tiene nada que
 * hacer, y decirle que reconecte sería mandarla a dar vueltas.
 *
 * Si las dos marcas vinieran a la vez, gana «todavía no disponible»: reconectar
 * no traería ninguna dirección, así que es lo único cierto que se puede decir.
 *
 * El `t()` del taller no interpola, así que el nombre se mete después. Por
 * `interpolar` y no por `replace` con una cadena: el nombre lo elige la
 * persona, y uno con `$&` adentro saldría cambiado.
 */
export function labelOf(drive: CloudDrive, t: (key: string) => string): string {
	if (drive.unavailable) return interpolar(t('cloudNotAvailableYet'), drive.name);
	if (drive.needsReconnect) return interpolar(t('cloudNeedsReconnect'), drive.name);
	return drive.name;
}
