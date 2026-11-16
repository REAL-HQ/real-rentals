
export const createServerFn = () => {
  const api = {
    middleware: () => api,
    inputValidator: (v) => ((api._v = v), api),
    handler: (fn) => (args) => fn({ ...args, data: api._v ? api._v(args.data) : args.data }),
  };
  return api;
};
