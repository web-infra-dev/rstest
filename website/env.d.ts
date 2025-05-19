declare module '*.mdx' {
  let MDXComponent: () => JSX.Element;
  export default MDXComponent;
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
