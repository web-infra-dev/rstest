export const formatUser = (name: string, role = 'member') => {
  const trimmed = name.trim();
  const [firstName = '', lastName = ''] = trimmed.split(' ');
  const normalized = `${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
  const displayName = `${firstName} ${lastName}`.trim();

  return {
    trimmed,
    firstName,
    lastName,
    normalized,
    displayName,
    role,
  };
};
