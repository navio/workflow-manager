export interface RemoteProfileSummary {
  userId: string;
  username: string | null;
  displayName: string | null;
  authMethod: string;
  scopes: string[];
}
