export const SEARCH_CONSTANTS = {
	DEFAULT_RESULT_LIMIT: 50,
	MIN_RESULT_LIMIT: 10,
	MAX_RESULT_LIMIT: 500,
	// Debajo de este largo no se consulta el índice global: una búsqueda de un
	// carácter lo satura (devuelve el tope entero y lo puntúa con Levenshtein)
	// para un resultado que el umbral de score vuelve inútil igual. La búsqueda
	// por rutas prioritarias no tiene ese costo y no la frena este piso.
	MIN_QUERY_LENGTH: 2,
};
