const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Settlement = sequelize.define('Settlement', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    positionIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    targetChain: {
      type: DataTypes.STRING,
      allowNull: false
    },
    netValue: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    txHash: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Settled', 'Failed'),
      defaultValue: 'Pending'
    }
  }, {
    tableName: 'settlements',
    indexes: [
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['targetChain'] }
    ]
  });

  return Settlement;
};
