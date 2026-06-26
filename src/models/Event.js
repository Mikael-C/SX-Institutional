const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Event = sequelize.define('Event', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    chain: {
      type: DataTypes.STRING,
      allowNull: false
    },
    contractAddress: {
      type: DataTypes.STRING,
      allowNull: false
    },
    eventName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    args: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },
    blockNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    txHash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'events',
    indexes: [
      { fields: ['chain'] },
      { fields: ['eventName'] },
      { fields: ['contractAddress'] },
      { fields: ['blockNumber'] },
      { fields: ['txHash'] },
      { fields: ['chain', 'eventName'] }
    ]
  });

  return Event;
};
