import { useState } from 'react';

export function EnvironmentCommentWidget() {
  const [count] = useState(41);
  return <section>widget-{count + 1}</section>;
}
