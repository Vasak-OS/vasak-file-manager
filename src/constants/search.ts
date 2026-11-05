export const SEARCH_CONSTANTS = {
	DEFAULT_RESULT_LIMIT: 50,
	MIN_RESULT_LIMIT: 10,
	MAX_RESULT_LIMIT: 500,
	// Debajo de este largo no se dispara la consulta global: una búsqueda de un
	// carácter satura el índice (devuelve el tope entero y lo puntúa con
	// Levenshtein) para un resultado que el umbral de score vuelve inútil igual.
	MIN_QUERY_LENGTH: 2,
};
