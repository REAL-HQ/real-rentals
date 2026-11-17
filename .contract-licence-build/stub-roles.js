
export const requireTier = async () => ({ tier: "owner", userId: "owner" });
export const requireStaff = requireTier;
export const requireManager = requireTier;
export const requireOwner = requireTier;
export const getActor = async () => null;
