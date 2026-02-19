declare module "*?worker" {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module "*.clab.yml?raw" {
  const content: string;
  export default content;
}

declare module "*.annotations.json?raw" {
  const content: string;
  export default content;
}
