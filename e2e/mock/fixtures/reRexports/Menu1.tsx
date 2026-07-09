import { useParams } from 'react-router-dom';

const Menu1 = () => {
  const { group, id } = useParams();

  return (
    <div>
      Menu1
      <div>{group}</div>
      <div>{id}</div>
    </div>
  );
};

export default Menu1;
