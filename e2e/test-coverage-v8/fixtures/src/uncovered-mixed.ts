export interface User {
  id: string;
}

export function getUserId(user: User): string {
  return user.id;
}
