// Temporary product focus. Set to null to reopen all existing workspaces.
export const workspaceFocus: string | null = "DIRECTOR";
export const isWorkspaceEnabled = (role: string) =>
  workspaceFocus === null || role === workspaceFocus;
