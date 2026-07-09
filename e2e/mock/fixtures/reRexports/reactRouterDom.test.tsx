import { describe, expect, it, rs } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import * as reactRouterDomActual from 'react-router-dom' with {
  rstest: 'importActual',
};
import { MemoryRouter } from 'react-router-dom';
import Menu1 from './Menu1';

rs.mock('react-router-dom', () => {
  return {
    ...reactRouterDomActual,
    useParams: rs.fn(() => ({ group: 'my_group', id: 'my_mock_group_id' })),
  };
});

describe('Menu1', () => {
  it('should render menu1', async () => {
    await render(
      <MemoryRouter initialEntries={['/menu1/group/my_mock_group_id']}>
        <Menu1 />
      </MemoryRouter>,
    );
    expect(screen.getByText('my_mock_group_id')).toBeTruthy();
  });
});
