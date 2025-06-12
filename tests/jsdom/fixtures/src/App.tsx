import './App.css';

const App = () => {
  return (
    <div className="content">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: test */}
      <h1
        onClick={() => {
          throw new Error('click error');
        }}
      >
        Rsbuild with React
      </h1>
      <p>Start building amazing things with Rsbuild.</p>
    </div>
  );
};

export default App;
