export const createServerFn = () => { const api = { middleware: () => api, handler: (fn) => fn }; return api; };
export const createMiddleware = () => ({ server: (fn) => fn });
