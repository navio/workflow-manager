import { HttpError } from "./responses.ts";

export interface OwnerProfile {
  id: string;
  username: string | null;
}

interface ProfileLookupResponse {
  data: OwnerProfile | null;
  error: { message: string } | null;
}

export interface OwnerProfileLookupService {
  from: (table: "profiles") => {
    select: (columns: "id, username") => {
      eq: (column: "username" | "id", value: string) => {
        maybeSingle: () => Promise<ProfileLookupResponse>;
      };
    };
  };
}

export async function resolveOwnerProfile(service: OwnerProfileLookupService, owner: string): Promise<OwnerProfile | null> {
  const { data: ownerByUsername, error: ownerByUsernameError } = await service.from("profiles").select("id, username").eq("username", owner).maybeSingle();
  if (ownerByUsernameError) throw new HttpError(500, "Failed to resolve workflow owner", ownerByUsernameError.message);
  if (ownerByUsername) return ownerByUsername;

  const { data: ownerById, error: ownerByIdError } = await service.from("profiles").select("id, username").eq("id", owner).maybeSingle();
  if (ownerByIdError) throw new HttpError(500, "Failed to resolve workflow owner", ownerByIdError.message);
  return ownerById;
}

export function ownerIdentifier(profile: OwnerProfile): string {
  return profile.username ?? profile.id;
}
