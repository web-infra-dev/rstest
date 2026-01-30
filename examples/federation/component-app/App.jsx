import React from 'react';
import Button from './src/Button';
import Dialog from './src/Dialog';
import Logo from './src/Logo';
export default class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      dialogVisible: false,
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
        <Logo />
        <br />
        <Button />
        <br />

        <button type="button" onClick={this.handleClick}>
          click to open dialog
        </button>
        <Dialog
          switchVisible={this.handleSwitchVisible}
          visible={this.state.dialogVisible}
        />
      </div>
    );
  }
}
