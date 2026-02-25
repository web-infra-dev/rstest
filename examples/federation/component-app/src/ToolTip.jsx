import React from 'react';
import './tool-tip.css';
export default class ToolTip extends React.Component {
  render() {
    return (
      <div className="tool-tip" data-content={this.props.message}>
        {this.props.content}
      </div>
    );
  }
}
