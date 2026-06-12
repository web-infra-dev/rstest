import Button from 'component-app/Button';
import Dialog from 'component-app/Dialog';
import ToolTip from 'component-app/ToolTip';
import NodeLocal from 'node-local-remote/test';
import React from 'react';
export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      dialogVisible: false,
      nodeLocalContent: String(NodeLocal || ''),
    };
    this.handleClick = this.handleClick.bind(this);
    this.handleSwitchVisible = this.handleSwitchVisible.bind(this);
  }
  handleClick(ev) {
    console.log(ev);
    this.setState({
      dialogVisible: true,
    });
  }
  handleSwitchVisible(visible) {
    this.setState({
      dialogVisible: visible,
    });
  }
  render() {
    return (
      <div>
        <h1>Open Dev Tool And Focus On Network,checkout resources details</h1>
        <p>
          react、react-dom js files hosted on <strong>main-app</strong>
        </p>
        <p>
          components hosted on <strong>component-app</strong>
        </p>
        <h4>Buttons:</h4>
        <Button type="primary" />
        <Button type="warning" />
        <h4>Dialog:</h4>
        <button type="button" onClick={this.handleClick}>
          click me to open Dialog
        </button>
        <Dialog
          switchVisible={this.handleSwitchVisible}
          visible={this.state.dialogVisible}
        />
        <h4>hover me please!</h4>
        <ToolTip content="hover me please" message="Hello,world!" />
        <h4>Node-local remote:</h4>
        <p>{this.state.nodeLocalContent}</p>
      </div>
    );
  }
}
