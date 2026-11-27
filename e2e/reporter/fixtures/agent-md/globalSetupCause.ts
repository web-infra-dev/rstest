const connect = () => {
  throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
};

export default function globalSetup() {
  try {
    connect();
  } catch (error) {
    throw new Error('Failed to start the test database', { cause: error });
  }
}
