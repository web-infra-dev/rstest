import React, { useState } from 'react';

export function TaskBoard() {
  const [taskTitle, setTaskTitle] = useState('');
  const [tasks, setTasks] = useState<string[]>([]);

  const addTask = () => {
    const value = taskTitle.trim();
    if (!value) {
      return;
    }

    setTasks((current) => [...current, value]);
    setTaskTitle('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      addTask();
    }
  };

  return (
    <section
      id="midscene-demo"
      style={{
        border: '2px solid #2f855a',
        borderRadius: '12px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        maxWidth: '640px',
        padding: '20px',
      }}
    >
      <h1 style={{ margin: '0 0 12px' }}>Task board</h1>
      <p style={{ margin: '0 0 10px' }}>Type a task title and click Add task</p>

      <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
        <input
          id="task-title"
          onChange={(event) => setTaskTitle(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Task title"
          style={{ padding: '10px 12px', width: '260px' }}
          type="text"
          value={taskTitle}
        />

        <button
          id="add-task"
          onClick={addTask}
          style={{ padding: '10px 14px' }}
          type="button"
        >
          Add task
        </button>
      </div>

      <p id="status" style={{ margin: '14px 0 8px' }}>
        {tasks.length} tasks
      </p>

      <ul id="task-list" style={{ paddingLeft: '20px' }}>
        {tasks.map((task) => {
          return <li key={task}>{task}</li>;
        })}
      </ul>
    </section>
  );
}
