import React from 'react';
import pictureData from './MF.jpeg';
export default function () {
  return (
    <img
      src={pictureData}
      alt="Module Federation logo"
      style={{ width: '500px', borderRadius: '10px' }}
    />
  );
}
