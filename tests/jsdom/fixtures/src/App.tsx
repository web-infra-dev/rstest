import './App.css';
import style from './App.module.css';

const App = () => {
  return (
    <div className="content">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: test */}
      <h1
        onClick={() => {
          throw new Error('click error');
        }}
        style={{
          fontSize: '16px',
        }}
      >
        Rsbuild with React
      </h1>
      <p className={style.contentP}>
        Start building amazing things with Rsbuild.
      </p>
    </div>
  );
};

export default App;
