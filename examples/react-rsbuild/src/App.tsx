import './App.css';
import { h2Title } from './module';

const App = () => {
  return (
    <div className="content">
      <h1>Rsbuild with React</h1>
      <h2>{h2Title()}</h2>
      <p>Start building amazing things with Rsbuild.</p>
    </div>
  );
};

export default App;
