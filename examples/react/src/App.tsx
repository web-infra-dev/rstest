import './App.css';

interface AppProps {
  greeting?: string;
}

const App = ({ greeting = 'Hello World' }: AppProps) => {
  return (
    <div className="content">
      <h1>{greeting}</h1>
      <p>Start building amazing things with React.</p>
    </div>
  );
};

export default App;
